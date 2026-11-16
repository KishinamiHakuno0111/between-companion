import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {inject} from 'postject';
import {NtExecutable,NtExecutableResource} from 'pe-library';
import * as ResEdit from 'resedit';

const root=dirname(fileURLToPath(import.meta.url)),work=resolve(root,'build'),output=resolve(root,process.env.BETWEEN_EXE_OUTPUT||'../此间.exe');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('请使用 Windows x64 Node.js 24 构建。');
await mkdir(work,{recursive:true});
await build({entryPoints:[resolve(root,'entry.js')],outfile:resolve(work,'app.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',minify:true,
  define:{'import.meta.url':'__betweenModuleUrl','globalThis.BETWEEN_EMBEDDED':'true'},
  banner:{js:"const __betweenModuleUrl = require('node:url').pathToFileURL(__filename).href;"},
});
const assets=Object.fromEntries(['index.html','app.js','chat-features.js','style.css'].map(name=>[`public/${name}`,resolve(root,'../public',name)]));
const license=resolve(root,'licenses/node-LICENSE.txt');await readFile(license);assets['licenses/Node.txt']=license;
const config={main:resolve(work,'app.cjs'),output:resolve(work,'app.blob'),disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false,assets};
await writeFile(resolve(work,'sea-config.json'),JSON.stringify(config,null,2));
execFileSync(process.execPath,['--experimental-sea-config',resolve(work,'sea-config.json')],{stdio:'inherit'});

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc]);}
function iconPng(size){
  const segments=[[33,25,75,25],[33,83,75,83],[37,28,37,80],[71,28,71,80],[37,54,71,54],[24,43,24,65],[84,43,84,65]];
  const data=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=(x+.5)*108/size,py=(y+.5)*108/size;
    const white=segments.some(([ax,ay,bx,by])=>{const t=Math.max(0,Math.min(1,((px-ax)*(bx-ax)+(py-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));return Math.hypot(px-ax-t*(bx-ax),py-ay-t*(by-ay))<2.2;});
    const outside=Math.hypot(Math.max(18-px,0,px-90),Math.max(18-py,0,py-90))>18;
    const offset=y*(size*4+1)+1+x*4;data.set(white?[255,248,242,255]:[119,85,110,outside?0:255],offset);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
const sizes=[32,48,64,128,256],images=sizes.map(iconPng),header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
images.forEach((png,i)=>{const j=6+i*16;header[j]=header[j+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,j+4);header.writeUInt16LE(32,j+6);header.writeUInt32LE(png.length,j+8);header.writeUInt32LE(offset,j+12);offset+=png.length;});
const ico=Buffer.concat([header,...images]);await writeFile(resolve(work,'between.ico'),ico);
const exe=NtExecutable.from(await readFile(process.execPath),{ignoreCert:true}),resources=NtExecutableResource.from(exe);
const icon=ResEdit.Data.IconFile.from(ico);
const groups=ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
for(const group of groups)ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icon.icons.map(item=>item.data));
for(const info of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)){
  info.setFileVersion(0,3,3,0,1033);info.setProductVersion(0,3,3,0,1033);
  info.setStringValues({lang:1033,codepage:1200},{FileDescription:'此间 · 陪伴聊天',ProductName:'此间 Between',CompanyName:'Between',InternalName:'between',OriginalFilename:'此间.exe',LegalCopyright:'Between · Includes Node.js under its license'});
  info.outputToResourceEntries(resources.entries);
}
resources.outputResource(exe);
const staged=resolve(work,'between.exe');await writeFile(staged,Buffer.from(exe.generate()));
await inject(staged,'NODE_SEA_BLOB',await readFile(config.output),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
await copyFile(staged,output);
const binary=await readFile(output);await writeFile(output+'.sha256',`${createHash('sha256').update(binary).digest('hex')}  ${output.split(/[\\/]/).at(-1)}\n`);
console.log(`Windows standalone executable ready: ${output} (${(binary.length/1024/1024).toFixed(1)} MiB)`);
