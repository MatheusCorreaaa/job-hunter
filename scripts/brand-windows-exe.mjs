import {readFileSync,writeFileSync} from 'node:fs';
import {Data,NtExecutable,NtExecutableResource,Resource} from 'resedit';

const [input,output]=process.argv.slice(2);
if (!input || !output) {
  throw new Error('Uso: npm run brand:windows -- electron.exe "Job Hunter.exe"');
}

const executable=NtExecutable.from(readFileSync(input));
const resources=NtExecutableResource.from(executable);
const groups=Resource.IconGroupEntry.fromEntries(resources.entries);
if (!groups.length) throw new Error('O executável não contém o ícone original do Electron.');

const iconPath=new URL('../src/assets/app-icon.ico',import.meta.url);
const icons=Data.IconFile.from(readFileSync(iconPath)).icons.map(({data})=>data);
for (const {id,lang} of groups) {
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries,id,lang,icons);
}
resources.outputResource(executable);
writeFileSync(output,Buffer.from(executable.generate()),{flag:'wx'});
