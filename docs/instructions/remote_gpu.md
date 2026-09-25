# Optional H100 over JupyterHub

Local CUDA or Apple MPS is the default. An H100 is not required to open the UI, preview existing rigs, or use local inference. This optional bridge sends only See-through decomposition to a GPU server; analysis, expression APIs, preparation, rigging, verification, and exports remain on your local machine.

The remote route currently verifies **H100** provenance. Other NVIDIA GPUs can use the **local CUDA** route; the remote H100 check is not a generic GPU compatibility claim. The source/model pins and precision are the same across both routes, but bitwise CUDA/MPS equivalence is not promised.

## Prepare the server

Use your own HTTPS Jupyter single-user server URL, authorized H100 allocation, and scoped token. Never commit tokens, embedded-credential URLs, or private hostnames. SSO login and allocation are managed by your JupyterHub administrator, not this app.

On the remote server, install Python 3.12, create a GPU environment, and copy these release files into `~/inkinesis-gpu/` while preserving relative paths:

- `requirements-gpu.txt`
- `tools/generate/downloadModels.py`
- `tools/generate/models/see-through.json`

Then run in the remote terminal:

```sh
cd ~/inkinesis-gpu
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
.venv/bin/python -m pip install -r requirements-gpu.txt ipykernel
.venv/bin/python -m ipykernel install --user --name inkinesis-h100 --display-name 'Inkinesis H100'
git clone https://github.com/shitagaki-lab/see-through.git see-through
git -C see-through checkout 7f139bb25c46a0c8ac720d95ddab185fcda5451c
.venv/bin/python tools/generate/downloadModels.py --output models
.venv/bin/python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name())"
```

Use a CUDA wheel build compatible with your actual driver. These commands do not provision or purchase a GPU. Respect server quotas and idle-culling policies.

## Configure path mapping

In your **local** `.env`:

```dotenv
RIG_GPU_BACKEND=h100
RIG_H100_QUEUE=.cache/rig/h100-queue
RIG_REMOTE_ROOT=/home/your-user/inkinesis-gpu
RIG_REMOTE_CONTENTS_ROOT=/home/your-user
```

`RIG_REMOTE_ROOT` is the absolute remote installation path. `RIG_REMOTE_CONTENTS_ROOT` is the absolute filesystem directory corresponding to the Jupyter Contents API root, which may differ from the kernel's home directory. The former must be inside the latter. For a Contents API rooted at `/home`, use `/home` for the latter; the bridge then transfers files under `your-user/inkinesis-gpu/...`. Do not copy another deployment's paths without checking them.

`h100` disables local fallback and does not require local See-through weights. `h100-first` makes one local attempt after a remote connection, execution, or transfer failure; it requires a fully configured local inference environment as well. Integrity/hash mismatches fail visibly instead of falling back.

## Start the local bridge and UI

```sh
.venv/bin/python -m pip install -r requirements-remote.txt
.venv/bin/python tools/remote/jupyterBridge.py \
  --url https://your-jupyter.example/user/your-user/ \
  --kernel inkinesis-h100 \
  --queue .cache/rig/h100-queue
```

Enter the token at the hidden prompt. It stays in process memory. Keep this terminal running, then start `npm run dev` in another terminal. Changing `.env` requires restarting the dev server. No `.env` file or provider API key is uploaded to the GPU server.

For an explicit CLI run:

```sh
npm run image-to-rig -- --image /path/to/character.png \
  --h100-queue .cache/rig/h100-queue --out outputs/remote-character
```

CLI H100 jobs remain strict, regardless of UI fallback settings. The bridge creates its own kernel and removes it on shutdown, without stopping other kernels or the GPU server.

## Failure and recovery

Jobs have a 30-second pickup deadline and an eight-minute client response deadline. Each attempt has isolated downloads; complete hash-verified artifacts are promoted together. Late remote completions cannot overwrite local fallback output. Tokens can expire independently of server allocation. Restore an authorized connection rather than bypassing SSO or disabling TLS checks.

Interrupted transfers may be recovered from the completed remote artifacts without rerunning inference: with the bridge running, pass the job's request file from the queue to `tools/remote/recoverDownload.ts`, which re-downloads the artifacts in verified chunks and promotes them into the run.

```sh
node --import tsx tools/remote/recoverDownload.ts .cache/rig/h100-queue/<job-id>.request.json
```

`remote-job.json`, `remote-execution.json`, and `local-decomposition.json` retain provenance inside the private run. Queue payloads and logs stay under ignored `.cache/`; do not publish them. A stopped bridge does not terminate a remote computation that has already begun.

### Reusing an older running bridge

If an older bridge requires relative directory paths, set `RIG_REMOTE_KERNEL_ROOT` to the kernel's actual working directory (`os.getcwd()`). The client sends directory creation relative to that root while uploads/downloads still use `RIG_REMOTE_CONTENTS_ROOT`. These roots can differ. New bridges accept both absolute paths and safe relative paths; parent traversal remains forbidden. Leave the compatibility override unset for the default absolute-path mode.
