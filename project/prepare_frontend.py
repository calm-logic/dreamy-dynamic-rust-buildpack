#!/usr/bin/env python3
"""Assemble a host app that imports the pinned generic admin library."""
from pathlib import Path
import json
import os
import shutil
import sys

FRONTEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FRONTEND.parent / 'tools'))
from foundation import checkout
SHARED = checkout(FRONTEND.parent, 'dynamic-rust-admin')
DEST = FRONTEND / '.work/admin'
if (DEST/'src').exists():
    shutil.rmtree(DEST/'src')
shutil.copytree(SHARED / 'src', DEST / 'src', dirs_exist_ok=True)
for name in ['quasar.conf.js','babel.config.js','.postcssrc.js','.eslintrc.js','yarn.lock']:
    if (SHARED/name).exists(): shutil.copy2(SHARED/name,DEST/name)
package=json.loads((SHARED/'package.json').read_text())
package.update(name='dream-project-ui',private=True)
package['dependencies'].update(package.pop('peerDependencies',{}))
library_path=os.path.relpath(SHARED,DEST)
package['dependencies']['dynamic-rust-admin']='file:'+library_path
lock=DEST/'yarn.lock'
entry='\n"dynamic-rust-admin@file:'+library_path+'":\n  version '+json.dumps(package['version'])+'\n  dependencies:\n'
entry+=''.join('    '+json.dumps(name)+' '+json.dumps(version)+'\n' for name,version in sorted(json.loads((SHARED/'package.json').read_text()).get('dependencies',{}).items()))
lock.write_text(lock.read_text()+entry)
for field in ['main','module','files']: package.pop(field,None)
(DEST/'package.json').write_text(json.dumps(package,indent=2)+'\n')
config=DEST/'quasar.conf.js'
config.write_text(config.read_text().replace('...config.resolve.alias,',f"...config.resolve.alias, 'dynamic-rust-admin': path.resolve(__dirname, '{library_path}'),").replace('extendWebpack(config) {',"extendWebpack(config) { config.resolve.modules = [path.resolve(__dirname,'node_modules'), ...(config.resolve.modules || ['node_modules'])];").replace('open: true,','open: false,'))
(DEST/'src/router/index.js').write_text('import {route} from "quasar/wrappers";\nimport {createAdminRouter} from "dynamic-rust-admin";\nexport default route(() => createAdminRouter());\n')
(DEST/'src/store/index.js').write_text('export {adminStore as default} from "dynamic-rust-admin";\n')
shutil.copytree(FRONTEND/'overrides',DEST/'src',dirs_exist_ok=True)
if (FRONTEND/'overrides/app.js').is_file():
    # Wire extensions into the actual mounted official admin app.
    (DEST/'src/boot').mkdir(exist_ok=True)
    (DEST/'src/boot/project-extension.js').write_text('import { boot } from "quasar/wrappers";\nimport configure from "../app";\nexport default boot(async context => { await configure(context); });\n')
    config.write_text(config.read_text().replace("boot: [", "boot: ['project-extension', ", 1))
index=DEST/'src/index.template.html'
index.write_text(index.read_text().replace('<head>','<head>\n<script src="/branding.js"></script>\n<script src="/app-config.js"></script>\n<script src="/admin-branding.js"></script>\n<script src="/api/preview/script.js"></script>'))
(DEST/'public').mkdir(exist_ok=True)
shutil.copy2(SHARED/'src/assets/brand-square.svg', DEST/'public/favicon.svg')
(DEST/'public/app-config.js').write_text('window.__DREAM_ADMIN_CONFIG__ = {apiUrl:"http://localhost:8090",name:"My app"};\n')
(DEST/'public/branding.js').write_text('window.__DREAM_BRANDING__ = {};\n')
(DEST/'public/branding.json').write_text('{}\n')
print(DEST)

# The public admin imports its own config module. Bridge host branding through its
# supported global config before its deferred application modules are evaluated.
(DEST/'public/admin-branding.js').write_text("""(() => {
  const config = window.__DREAM_ADMIN_CONFIG__ || {};
  const branding = window.__DREAM_BRANDING__ || {};
  window.__DYNAMIC_ADMIN_CONFIG__ = {
    ...config,
    logo: branding.logo_light_url || branding.logo_url || config.logo,
    logoDark: branding.logo_dark_url || branding.logo_url || config.logoDark || config.logo,
  };
})();
""")
