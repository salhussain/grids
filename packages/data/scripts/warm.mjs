// Downloads the Python packages scripts use (pandas, numpy) so the locked-down script process, which cannot write
// files or reach the network, finds them on disk. Run once on every machine that runs scripts: pnpm --filter @grids/data warm
import { loadPyodide } from 'pyodide';
const py = await loadPyodide();
await py.loadPackage(['pandas', 'numpy']);
console.log('Python packages ready.');
