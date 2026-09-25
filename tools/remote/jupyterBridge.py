#!/usr/bin/env python3
"""Private local job queue over an existing, scoped JupyterHub connection.

Run in a VS Code terminal. The token is prompted without echo and kept only in
memory. No listening port, SSH daemon, global configuration or stored credential.
Install websocket-client in a dedicated client environment before running.
"""
import argparse
import base64
import getpass
import json
from pathlib import Path
import socket
import time
import urllib.parse
import urllib.request
import uuid

import websocket


def atomic(path, value):
    pending = path.with_suffix('.pending')
    pending.write_text(json.dumps(value, indent=2) + '\n')
    pending.replace(path)


def safe_relative(value):
    path = Path(value)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('Remote file paths must be relative to the user server')
    return urllib.parse.quote(path.as_posix(), safe='/')


class Connection:
    def __init__(self, url, token, kernel_name):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != 'https' or parsed.query or parsed.username:
            raise ValueError('Use an HTTPS server URL without embedded credentials')
        self.url, self.token = url.rstrip('/') + '/', token
        self.kernel = None
        self.kernel_name = kernel_name

    def request(self, path, method='GET', data=None):
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.url + path, data=body, method=method,
            headers={'Authorization': 'token ' + self.token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
        return json.loads(raw) if raw else None

    def execute(self, code, log, timeout=7200):
        if not self.kernel:
            self.kernel = self.request('api/kernels', 'POST', {'name': self.kernel_name})['id']
        session = uuid.uuid4().hex
        ws_url = self.url.replace('https://', 'wss://', 1) + 'api/kernels/' + self.kernel + '/channels?session_id=' + session
        ws = websocket.create_connection(ws_url, header=['Authorization: token ' + self.token],
                                         timeout=15, suppress_origin=True)
        message_id = uuid.uuid4().hex
        message = {'header': {'msg_id': message_id, 'username': 'inkinesis',
            'session': session, 'msg_type': 'execute_request', 'version': '5.3'},
            'parent_header': {}, 'metadata': {}, 'channel': 'shell',
            'content': {'code': code, 'silent': False, 'store_history': False,
                        'user_expressions': {}, 'allow_stdin': False, 'stop_on_error': True}}
        started = time.monotonic()
        failure = None
        try:
            ws.send(json.dumps(message))
            while time.monotonic() - started < timeout:
                try:
                    raw = ws.recv()
                except (websocket.WebSocketTimeoutException, socket.timeout):
                    continue
                if not raw:
                    raise RuntimeError('Kernel connection closed; inspect the remote job before resubmitting')
                data = json.loads(raw)
                if data.get('parent_header', {}).get('msg_id') != message_id:
                    continue
                kind, content = data.get('msg_type', data.get('header', {}).get('msg_type')), data['content']
                if kind == 'stream':
                    log.write(content['text'].replace(self.token, '[redacted]')); log.flush()
                if kind == 'error':
                    failure = content.get('ename', 'RemoteError') + ': ' + content.get('evalue', '')
                    log.write(failure.replace(self.token, '[redacted]') + '\n'); log.flush()
                if kind == 'status' and content.get('execution_state') == 'idle':
                    if failure:
                        raise RuntimeError(failure)
                    return
            raise TimeoutError('Remote execution deadline exceeded; inspect remote state before resubmitting')
        finally:
            ws.close()

    def upload(self, local, remote):
        destination = safe_relative(remote)
        # The dedicated root is created through the kernel before content uploads.
        self.request('api/contents/' + destination, 'PUT', {'type': 'file', 'format': 'base64',
                     'content': base64.b64encode(Path(local).read_bytes()).decode()})

    def download(self, remote, local):
        data = self.request('api/contents/' + safe_relative(remote) + '?format=base64')
        if data['format'] != 'base64' or data['type'] != 'file':
            raise ValueError('Expected a binary file from the remote server')
        path = Path(local)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.pending')
        temporary.write_bytes(base64.b64decode(''.join(data['content'].split()), validate=True))
        temporary.replace(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True, help='HTTPS single-user server base URL')
    p.add_argument('--queue', type=Path, default=Path('.cache/rig/h100-queue'))
    p.add_argument('--kernel', default='inkinesis-h100', help='Installed GPU kernelspec name')
    args = p.parse_args()
    queue = args.queue.resolve(); queue.mkdir(parents=True, exist_ok=True, mode=0o700)
    token = getpass.getpass('JupyterHub token (hidden, memory only): ')
    connection = Connection(args.url, token, args.kernel)
    connection.request('api/kernelspecs')
    atomic(queue / 'bridge.json', {'status': 'ready', 'started': time.time()})
    print('Authenticated. H100 job queue ready.', flush=True)
    try:
        while True:
            atomic(queue / 'heartbeat.json', {'time': time.time()})
            for request in sorted(queue.glob('*.request.json')):
                result = request.with_name(request.name.replace('.request.json', '.result.json'))
                running = request.with_name(request.name.replace('.request.json', '.running.json'))
                cancelled = request.with_name(request.name.replace('.request.json', '.cancelled.json'))
                if result.exists() or running.exists() or cancelled.exists():
                    continue
                job = json.loads(request.read_text())
                atomic(running, {'started': time.time()})
                started = time.monotonic()
                with request.with_suffix('.log').open('w') as log:
                    try:
                        if job.get('mkdir'):
                            directories = [str(Path(x).parent) for x in job['mkdir']]
                            if any('..' in Path(d).parts or not Path(d).parts for d in directories):
                                raise ValueError('Remote directories must not contain parent traversal')
                            connection.execute('from pathlib import Path\n' + '\n'.join(
                                'Path(' + repr(d) + ').mkdir(parents=True,exist_ok=True)' for d in directories), log)
                        for transfer in job.get('uploads', []): connection.upload(**transfer)
                        connection.execute(job['code'], log, job.get('timeout', 7200))
                        for transfer in job.get('downloads', []): connection.download(**transfer)
                        atomic(result, {'status': 'complete', 'seconds': time.monotonic() - started})
                    except Exception as error:
                        atomic(result, {'status': 'failed', 'seconds': time.monotonic()-started,
                            'error': str(error).replace(token, '[redacted]'),
                            'note': 'No automatic resubmission. Inspect remote artifacts before retrying.'})
                print(request.name + ': ' + json.loads(result.read_text())['status'], flush=True)
            time.sleep(1)
    finally:
        atomic(queue / 'bridge.json', {'status': 'stopped', 'finished': time.time()})
        if connection.kernel:
            connection.request('api/kernels/' + connection.kernel, 'DELETE')


if __name__ == '__main__':
    main()
