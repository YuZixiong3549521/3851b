import {mockJobs, DEMO_DATE} from '../data/mockJobs.js';
export const useMock = import.meta.env.VITE_USE_MOCK !== 'false';
export function getPortalDate(){const d=new Date();return useMock?DEMO_DATE:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
// Backend contract: GET /api/technician/jobs -> { jobs: Job[] }.
// Database credentials belong only in the Node/Express server.
export async function getJobs({signal}={}) {
 if(useMock) return mockJobs.map(job=>({...job}));
 const response = await fetch(`${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/,'')}/technician/jobs`,{signal,credentials:'include'});
 if(!response.ok) throw new Error(`Could not load jobs (${response.status}). Please try again.`);
 const data=await response.json();
 if(!Array.isArray(data.jobs)||data.jobs.some(j=>!['id','customer','date','time','serviceType','address','priority','status'].every(k=>typeof j[k]==='string'))) throw new Error('The server returned an invalid jobs response.');
 return data.jobs;
}
