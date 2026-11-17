import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url)),assets=resolve(root,'build/assets');
await mkdir(assets,{recursive:true});
await build({entryPoints:[resolve(root,'runtime/entry.js')],outfile:resolve(assets,'runtime.js'),bundle:true,format:'esm',platform:'browser',target:'chrome100',minify:true,
  inject:[resolve(root,'runtime/platform.js')],
  plugins:[{name:'android-native-platform',setup(build){build.onResolve({filter:/^node:/},()=>({path:resolve(root,'runtime/platform.js')}));}}],
});
const html=(await readFile(resolve(root,'../public/index.html'),'utf8')).replace('src="/app.js"','src="/runtime.js"');
await writeFile(resolve(assets,'index.html'),html);
await copyFile(resolve(root,'../public/style.css'),resolve(assets,'style.css'));
await build({entryPoints:[resolve(root,'runtime/background.js')],outfile:resolve(assets,'background.js'),bundle:true,format:'esm',platform:'browser',target:'chrome100',minify:true,inject:[resolve(root,'runtime/platform.js')],plugins:[{name:'android-background',setup(build){build.onResolve({filter:/^node:/},()=>({path:resolve(root,'runtime/platform.js')}));}}]});
await writeFile(resolve(assets,'background.html'),'<!doctype html><html><head><meta charset="UTF-8"><script type="module" src="/background.js"></script></head><body></body></html>');
console.log('Android web bundle ready.');
