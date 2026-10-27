import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const skill='C:/Users/Egemen/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11348/skills/presentations';
const workspaceDir='C:/Users/Egemen/Desktop/T Bot';
const candidatePath=path.join(workspaceDir,'artifacts/build/v1-additions/draft.pptx');
const finalPath=path.join(workspaceDir,'artifacts/output/V1 Son Ekleneler.pptx');
const stagingDir=path.join(workspaceDir,'artifacts/build/v1-additions/finalizer');
await fs.mkdir(stagingDir,{recursive:true});
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath,pythonExecutable:'C:/Users/Egemen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(stagingDir,'validation.json')});
console.log(JSON.stringify(result));

