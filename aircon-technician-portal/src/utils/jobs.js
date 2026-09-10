export const statuses=['Assigned','On the Way','In Progress','Pending','Completed'];
export const priorities=['Normal','High','Urgent'];
export const formatDate=(date,options={day:'numeric',month:'short',year:'numeric'})=>new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',options);
export const formatTime=time=>{const [h,m]=time.split(':');return `${String(Number(h)%12||12).padStart(2,'0')}:${m} ${Number(h)<12?'AM':'PM'}`;};
export const isUpcoming=(job,today)=>job.date>today&&job.status!=='Completed';
export function filterJobs(jobs,{tab='All Jobs',query='',date='',status='',priority=''},today){return jobs.filter(j=>(tab==='All Jobs'||(tab==='Today'?j.date===today:tab==='Upcoming'?isUpcoming(j,today):j.status===tab))&&(!query||`${j.id} ${j.customer}`.toLowerCase().includes(query.trim().toLowerCase()))&&(!date||j.date===date)&&(!status||j.status===status)&&(!priority||j.priority===priority));}
export function getStats(jobs,today){return {total:jobs.length,today:jobs.filter(j=>j.date===today).length,upcoming:jobs.filter(j=>isUpcoming(j,today)).length,inProgress:jobs.filter(j=>j.status==='In Progress').length,completed:jobs.filter(j=>j.status==='Completed').length,pending:jobs.filter(j=>j.status==='Pending').length};}
