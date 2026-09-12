import {mockJobs, DEMO_DATE} from '../data/mockJobs.js';
export const useMock = import.meta.env.VITE_USE_MOCK === 'true';
export function getPortalDate(){const d=new Date();return useMock?DEMO_DATE:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
// Backend contract: GET /api/technician/jobs -> { jobs: Job[] }.
// Database credentials belong only in the Node/Express server.
export async function getPortalData({signal}={}) {
 if(useMock) return {jobs:mockJobs.map(job=>({...job})),technician:{name:'Daniel Torres',role:'Field Technician',initials:'DT'}};
 const response = await fetch(`${(import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/,'')}/technician/jobs`,{signal,credentials:'include'});
 if(response.status===401){window.location.assign('/#/login');throw new Error('Please sign in.');}
 if(!response.ok) throw new Error(`Could not load jobs (${response.status}). Please try again.`);
 const data=await response.json();
 if(!Array.isArray(data.jobs)||data.jobs.some(j=>!['id','customer','date','time','serviceType','address','priority','status'].every(k=>typeof j[k]==='string'))) throw new Error('The server returned an invalid jobs response.');
 if(!data.technician || typeof data.technician.name!=='string') throw new Error('The server returned an invalid technician response.');
 return data;
}
export async function getJobs(options) { return (await getPortalData(options)).jobs; }
export async function technicianRequest(path,{signal,body,method='POST'}={}) {
 const base=(import.meta.env.VITE_API_BASE_URL||'/api').replace(/\/$/,'');
 let csrf='';
 if(body!==undefined){const session=await fetch(`${base}/session`,{credentials:'include'});csrf=(await session.json()).csrf;}
 const response=await fetch(`${base}/technician${path}`,{signal,credentials:'include',method:body===undefined?'GET':method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();
 if(!response.ok){const error=new Error(data.error||'The request could not be completed.');error.status=response.status;throw error;}
 return data;
}
