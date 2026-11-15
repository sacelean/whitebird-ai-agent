import { readFile } from 'node:fs/promises';
import { validateKnowledge } from '../src/context-knowledge.js';
if (!process.argv[2]) throw Error('Usage: npm run context:validate -- /path/bots.json');
validateKnowledge(JSON.parse(await readFile(process.argv[2], 'utf8')));
console.log('Context catalog valid');
