#!/bin/sh
# Stage Inochi2D 0.8.7's source for the headless check, and say what was changed.
#
# WHY A COPY RATHER THAN A PLAIN DEPENDENCY. Their `renderless` configuration --
# the library's own headless mode -- does not compile in 0.8.7. `Composite.
# drawOne` calls three OpenGL mask entry points that exist only under
# `InDoesRender`, while `Part.drawOne`, five files away, wraps the identical
# block in the guard that is missing here. It is one omitted `version` block.
#
# So this stages their release verbatim and applies
# `inochi2d-0.8.7-renderless.patch`, which adds that guard and nothing else. The
# patch touches a DRAW path, which a headless check never reaches: loading,
# deserialisation and the node tree are untouched, which is the whole of what
# the check reads.
#
# The staged tree is build output, not source, and is not committed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cache="$HOME/.dub/packages/inochi2d/0.8.7/inochi2d"
staged="$here/.inochi2d"

[ -d "$cache" ] || dub fetch inochi2d@0.8.7
[ -d "$cache" ] || { echo "no inochi2d 0.8.7 in the dub cache and none could be fetched" >&2; exit 1; }

rm -rf "$staged"
cp -R "$cache" "$staged"
# `preBuildCommands` runs `gitver`, which stamps a version from git history the
# release does not carry. The stamp is written here instead so the build needs
# no network and no repository.
python3 - "$staged" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
spec = json.loads((root / 'dub.json').read_text())
spec.pop('preBuildCommands', None)
(root / 'dub.json').write_text(json.dumps(spec, indent='\t') + '\n')
ver = root / 'source/inochi2d/ver.d'
ver.write_text('module inochi2d.ver;\n'
               'enum IN_VERSION = "0.8.7";\n'
               'enum IN_APP_NAME = "Inochi2D";\n')
PY
patch -s -p1 -d "$staged" < "$here/inochi2d-0.8.7-renderless.patch"

echo "staged inochi2d 0.8.7 at $staged, with inochi2d-0.8.7-renderless.patch applied"
