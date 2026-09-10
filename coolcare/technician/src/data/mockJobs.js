// A fixed demo date keeps the supplied September screenshots reproducible.
export const DEMO_DATE = '2026-09-01';
export const technician = {name:'Daniel Torres',role:'Field Technician',initials:'DT'};
const rows = [
 ['Sarah Mitchell','2026-09-01','08:00','AC Servicing','42 Elm Street, Northvale','Normal','In Progress'],
 ['James Wong','2026-09-01','10:30','Fault Diagnosis','88 Maple Avenue, Westbrook','High','On the Way'],
 ['Priya Sharma','2026-09-01','12:00','Unit Installation','15 Oak Lane, Eastfield','Normal','Assigned'],
 ['Robert Chen','2026-09-01','14:30','Emergency Repair','200 Pine Road, Southgate','Urgent','Pending'],
 ['Linda Nguyen','2026-09-02','09:00','AC Servicing','7 Cedar Avenue, Lakeside','Normal','Assigned'],
 ['Tom Baker','2026-09-02','11:30','Gas Leak Check','55 Birch Street, Hillcrest','High','Assigned'],
 ['Maria Santos','2026-09-03','08:30','Warranty Service','23 Willow Road, Greenfield','Normal','Assigned'],
 ['Kevin Park','2026-09-03','13:00','Fault Diagnosis','90 Poplar Boulevard, Riverside','High','Assigned'],
 ['Emma Wilson','2026-09-04','10:00','AC Servicing','12 Garden Road, Northvale','Normal','Assigned'],
 ['David Lee','2026-08-31','09:00','AC Servicing','8 River Lane, Westbrook','Normal','Completed'],
 ['Aisha Rahman','2026-08-31','11:00','Unit Installation','31 Park Street, Lakeside','Normal','Completed'],
 ['Michael Tan','2026-08-30','10:30','Fault Diagnosis','65 Hill Road, Hillcrest','High','Completed'],
 ['Sophie Lim','2026-08-29','14:00','Warranty Service','9 Lake Avenue, Eastfield','Normal','Completed'],
 ['Alex Brown','2026-08-28','15:00','AC Servicing','44 West Road, Riverside','Normal','Completed'],
];
export const mockJobs = rows.map((r,i)=>({id:`AC-${2841+i}`,customer:r[0],date:r[1],time:r[2],serviceType:r[3],address:r[4],priority:r[5],status:r[6],reportedProblem: r[3]==='Emergency Repair'?'Unit is not cooling and requires urgent inspection.':'Inspect the air conditioning unit and carry out the assigned service.',initials:r[0].split(' ').map(n=>n[0]).join('')}));
