import { createHash,randomUUID } from 'node:crypto';
import { annualVisitSchedule,addCalendarMonths } from '../server/customer/annual-bookings.mjs';
import { addCalendarDays,isCalendarDate,isWeekday,nextWeekday } from '../server/customer/booking-schedule.mjs';
import { getBookingOptions,resolveBookingSelection,saveBookingSelection } from '../server/customer/booking-options.mjs';

// All people, addresses, equipment, reports and operating events below are
// fictional development scenarios, never records of actual customer work.
// This module does not clear tables, commit, send mail or change existing login
// passwords. The caller owns a backed-up transaction and an empty business set.
const demoHash='$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.';
const money=value=>Number(Number(value).toFixed(2));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previousWeekday=date=>{while(!isWeekday(date))date=addCalendarDays(date,-1);return date;};
const sqlUtc=(date,time='10:00:00')=>new Date(`${date}T${time}+08:00`).toISOString().slice(0,19).replace('T',' ');
const plusMinutes=(timestamp,minutes)=>new Date(new Date(timestamp.replace(' ','T')+'Z').getTime()+minutes*60000).toISOString().slice(0,19).replace('T',' ');
const timeWindows={morning:{start:'09:00:00',label:'09:00 AM - 11:00 AM'},afternoon:{start:'14:00:00',label:'02:00 PM - 04:00 PM'}};

export function realisticScenarioDates(asOf) {
  if(!isCalendarDate(asOf)||asOf<'1002-01-01'||asOf>'9997-12-31')throw new Error('Pass a supported Singapore calendar date as asOf.');
  return {asOf,past:days=>previousWeekday(addCalendarDays(asOf,-days)),future:days=>nextWeekday(addCalendarDays(asOf,days)),
    aliceAnnual:nextWeekday(addCalendarMonths(asOf,-5)),benAnnual:nextWeekday(addCalendarDays(asOf,28))};
}

export async function seedRealisticData(connection,{asOf}={}) {
  const dates=realisticScenarioDates(asOf);
  const [[existingBookings]]=await connection.query('SELECT COUNT(*) AS count FROM booking');
  if(Number(existingBookings.count)!==0)throw new Error('Seed requires cleared business tables inside the caller transaction.');
  const [roles]=await connection.query('SELECT role_id,role_name FROM role');
  const roleId=name=>{const role=roles.find(row=>row.role_name===name);if(!role)throw new Error(`Missing role: ${name}`);return role.role_id;};
  const accounts=[];
  async function account(key,name,email,role,phone) {
    let [[user]]=await connection.execute(`SELECT u.user_id AS userId,u.full_name AS name,u.email,u.phone,r.role_name AS role
      FROM user_account u JOIN role r ON r.role_id=u.role_id WHERE u.email=?`,[email]);
    let created=false;
    if(!user) {
      const [inserted]=await connection.execute('INSERT INTO user_account(role_id,full_name,email,password_hash,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        [roleId(role),name,email,demoHash,phone,sqlUtc(dates.past(220)),sqlUtc(dates.past(220))]);
      user={userId:inserted.insertId,name,email,phone,role};created=true;
    }
    if(user.role!==role)throw new Error(`Scenario account role mismatch: ${email}`);
    if(role==='Customer') {
      await connection.execute('INSERT IGNORE INTO customer(user_id) VALUES (?)',[user.userId]);
      const [[profile]]=await connection.execute('SELECT customer_id AS customerId FROM customer WHERE user_id=?',[user.userId]);
      Object.assign(user,profile);
    }else if(role==='Technician') {
      await connection.execute("INSERT IGNORE INTO technician(user_id,availability_status) VALUES (?,'Available')",[user.userId]);
      const [[profile]]=await connection.execute('SELECT technician_id AS technicianId FROM technician WHERE user_id=?',[user.userId]);
      Object.assign(user,profile);
      await connection.execute("UPDATE technician SET availability_status='Available' WHERE technician_id=?",[user.technicianId]);
    }else {
      await connection.execute('INSERT IGNORE INTO admin_profile(user_id,department,position) VALUES (?,?,?)',[user.userId,'Operations',key==='norshida'?'Operations Manager':'Service Coordinator']);
    }
    user={...user,key,created};accounts.push(user);return user;
  }
  const alice=await account('alice','Alice Tan','alice.tan@coolcare.demo','Customer','9123 4567');
  const ben=await account('ben','Ben Lee','ben.lee@coolcare.demo','Customer','9234 5678');
  const priya=await account('priya','Priya Nair','priya.nair@example.test','Customer','+65 8000 0101');
  const marcus=await account('marcus','Marcus Goh','marcus.goh@example.test','Customer','+65 8000 0102');
  const nur=await account('nur','Nur Aisyah','nur.aisyah@example.test','Customer','+65 8000 0103');
  const evelyn=await account('evelyn','Evelyn Koh','evelyn.koh@example.test','Customer','+65 8000 0104');
  const chris=await account('chris','Chris Lim','chris.lim@coolcare.demo','Technician','9345 6789');
  const farah=await account('farah','Farah Ahmad','farah.ahmad@coolcare.demo','Technician','9456 7890');
  const daniel=await account('daniel','Daniel Ong','daniel.ong@example.test','Technician','+65 8000 0201');
  const norshida=await account('norshida','Norshida Selamat','norshida@coolcare.demo','Admin','9567 8901');
  const mei=await account('mei','Mei Wong','mei.wong@coolcare.demo','Admin','9678 9012');
  const customerAccounts=[alice,ben,priya,marcus,nur,evelyn],technicians=[chris,farah,daniel];
  const options=await getBookingOptions(connection);
  const cleaning=options.services.find(service=>service.code==='cleaning');
  const repair=options.services.find(service=>service.code==='repair');
  const bundle=options.bundles.find(item=>item.code==='annual-cleaning');
  if(!cleaning||!repair||!bundle)throw new Error('The current Cleaning, Repair and Annual Cleaning Bundle catalogues are required.');
  const [parts]=await connection.query('SELECT part_id,part_name,current_stock,recommended_units_per_ac,stock_unit FROM part ORDER BY part_id');
  if(parts.some(part=>Number(part.current_stock)!==0))throw new Error('Part stock must be zero before rebuilding its opening ledger.');
  const partNamed=name=>{const part=parts.find(item=>item.part_name===name);if(!part)throw new Error(`Missing current part: ${name}`);return part;};
  ['Aircon Filter','Drain Hose','Capacitor 35uF','Coil Cleaner (500 mL)','Cable Tie','Condensate Pump'].forEach(partNamed);
  const addresses=[],units=[],bookings=[],series=[],assignments=[],jobs=[],reports=[],assessments=[],inventory=[],inventoryRevisions=[];

  async function address(key,owner,label,line,postalCode,count,brand,model,locations=['Living room','Main bedroom','Bedroom 2','Study']) {
    const [inserted]=await connection.execute('INSERT INTO service_address(customer_id,address_label,address_line,postal_code,is_default,is_archived) VALUES (?,?,?,?,?,FALSE)',
      [owner.customerId,label,line,postalCode,!addresses.some(item=>item.customerId===owner.customerId)]);
    const row={key,addressId:inserted.insertId,customerId:owner.customerId,addressLine:line,unitIds:[],owner};
    for(let index=0;index<count;index++) {
      const [unit]=await connection.execute(`INSERT INTO aircon_unit(customer_id,address_id,brand,model,serial_number,installation_location,warranty_status) VALUES (?,?,?,?,?,?,?)`,
        [owner.customerId,row.addressId,brand,model,`CC-SC-${key.toUpperCase()}-${index+1}`,locations[index],index===0?'Out of Warranty':'In Warranty']);
      row.unitIds.push(unit.insertId);units.push({unitId:unit.insertId,addressId:row.addressId,customerId:owner.customerId});
    }
    addresses.push(row);return row;
  }
  const aliceHome=await address('alice-home',alice,'Home','118 Clementi Avenue 3, #08-142, Singapore','120118',3,'Daikin','FTKM25UVMG');
  const aliceOffice=await address('alice-office',alice,'Home office','27 River Valley Road, #03-12, Singapore','179024',2,'Mitsubishi Electric','MSY-GR10VF',['Work area','Study']);
  const benHome=await address('ben-home',ben,'Home','86 Punggol Field, #12-306, Singapore','828815',4,'Mitsubishi Electric','MSY-GR13VF');
  const benStudio=await address('ben-studio',ben,'Studio','32 Joo Chiat Place, #02-08, Singapore','427756',2,'Panasonic','CS-XU9XKZW',['Main studio','Editing room']);
  const priyaHome=await address('priya-home',priya,'Home','45 Tampines Avenue 9, #09-116, Singapore','529620',3,'Daikin','FTKM35UVMG');
  const marcusHome=await address('marcus-home',marcus,'Home','73 Bishan Street 12, #06-204, Singapore','579807',2,'Mitsubishi Electric','MSY-GR10VF');
  const nurHome=await address('nur-home',nur,'Home','61 Woodlands Drive 16, #10-318, Singapore','737901',3,'Panasonic','CS-XU12XKZW');
  const evelynHome=await address('evelyn-home',evelyn,'Home','24 Bukit Batok Street 31, #05-102, Singapore','659449',4,'Daikin','FTKM25UVMG');

  const plans=[];
  function single(key,address,serviceCode,date,status,notes,extra={}) {
    const plan={key,address,serviceCode,date,status,notes,window:'morning',...extra};plans.push(plan);return plan;
  }
  async function annual(key,address,firstDate,statuses,techs) {
    const requestId=randomUUID(),createdAt=sqlUtc(firstDate>asOf?dates.past(7):previousWeekday(addCalendarDays(firstDate,-28)));
    const selection=await resolveBookingSelection(connection,address.customerId,{packageId:bundle.packageId,requestId},address.unitIds.length);
    if(selection.totalAmount<0||!Number.isFinite(selection.totalAmount))throw new Error('Invalid annual catalogue price.');
    const schedule=annualVisitSchedule(firstDate,selection.totalAmount);
    const [inserted]=await connection.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,[address.customerId,address.addressId,bundle.packageId,bundle.name,firstDate,address.unitIds.length,selection.totalAmount,requestId,createdAt]);
    const row={key,seriesId:inserted.insertId,customerId:address.customerId,addressId:address.addressId,totalAmount:selection.totalAmount,createdAt,requestId,visits:[]};series.push(row);
    for(const visit of schedule) {
      const index=visit.visitNumber-1;
      plans.push({key:`${key}-${visit.visitNumber}`,address,serviceCode:'cleaning',date:visit.preferredDate,status:statuses[index],window:'morning',
        notes:`Quarterly cleaning visit ${visit.visitNumber} of 4. Please check airflow and drainage in all rooms.`,tech:techs[index],selection,
        annual:row,visit,createdAt,duration:95,work:'Removed and washed reusable filters, cleaned evaporator surfaces and blower housings, flushed condensate drains and checked cooling in all rooms.',
        findings:visit.visitNumber===1?'Dust accumulation on the living-room filter and minor debris in the drain pan. No refrigerant leak symptoms observed.':'Light surface dust consistent with quarterly use. Drainage remained clear and all units responded to the remote controls.',
        solution:'Completed routine cleaning, confirmed steady drainage and measured return/supply air temperatures of 27°C / 16°C after stabilisation.'});
    }
  }
  await annual('alice-annual',aliceHome,dates.aliceAnnual,['Completed','Completed','Assigned','Confirmed'],[chris,farah,chris,null]);
  await annual('ben-annual',benHome,dates.benAnnual,['Assigned','Confirmed','Submitted','Submitted'],[daniel,null,null,null]);
  single('alice-cleaning',aliceOffice,'cleaning',dates.past(66),'Completed','Routine cleaning for both office units. The study has slightly reduced airflow.',
    {tech:chris,window:'afternoon',duration:85,work:'Washed filters, cleaned blower outlets and drain pans, flushed the drainage line and checked cooling across both office units.',
      findings:'Uneven dust build-up on the study filter; no abnormal compressor noise.',solution:'Routine cleaning restored even airflow. Supply temperatures stabilised between 15°C and 17°C.'});
  single('alice-repair',aliceHome,'repair',dates.past(24),'Completed','Water drips from the main-bedroom indoor unit after about twenty minutes of use.',
    {tech:chris,duration:85,work:'Inspected condensate drainage, removed the obstructed hose section, fitted a replacement elbow and tested the unit through two drain cycles.',
      findings:'Partially blocked drain hose and a loose drain elbow at the indoor-unit outlet.',solution:'Replaced two metres of damaged hose and one elbow; secured the connection and confirmed there was no leakage during a thirty-minute test.',
      parts:[['Drain Hose',3],['Drain Elbow',1],['Cable Tie',2]],returns:[['Drain Hose',1]]});
  single('alice-cancelled',aliceOffice,'cleaning',dates.past(10),'Cancelled','Planned office cleaning.',{cancelReason:'Customer travelling; requested cancellation before technician allocation.'});
  single('alice-upcoming-clean',aliceOffice,'cleaning',dates.future(16),'Submitted','Please service both units and check the study drain pan. Building access is via the side entrance.');
  single('alice-upcoming-repair',aliceHome,'repair',dates.future(22),'Confirmed','Bedroom 2 occasionally stops cooling. Please diagnose the fault before quoting replacement work.',{window:'afternoon'});
  single('ben-cleaning',benHome,'cleaning',dates.past(78),'Completed','Routine cleaning for four units; living-room airflow is weaker than usual.',
    {tech:farah,duration:110,work:'Cleaned four indoor units, rinsed filters, cleared drain outlets and checked fan operation.',findings:'Dust on filters and a small amount of debris in the living-room drain pan.',solution:'Removed the debris, restored drainage and verified stable cooling in every room.'});
  single('ben-repair',benStudio,'repair',dates.past(40),'Completed','Studio unit takes longer to start and makes a brief humming sound.',
    {tech:daniel,window:'afternoon',duration:75,work:'Isolated the supply, tested the capacitor and wiring, installed a matching 35 µF replacement and verified startup.',
      findings:'Existing capacitor measured below its rated tolerance. No wiring damage found.',solution:'Replaced the failed capacitor and secured the wiring. Three restart tests completed without humming.',parts:[['Capacitor 35uF',1],['Cable Tie',2]]});
  single('ben-cancelled',benStudio,'cleaning',dates.future(20),'Cancelled','Studio cleaning request.',{cancelReason:'Customer chose to postpone studio service until renovation is complete.'});
  const otherScenarios=[
    {owner:priya,address:priyaHome,tech:farah,days:93,offset:17,service:'cleaning',note:'Please check dust and drainage in the main bedroom.'},
    {owner:marcus,address:marcusHome,tech:daniel,days:57,offset:18,service:'cleaning',note:'Routine cleaning for the living room and bedroom.'},
    {owner:nur,address:nurHome,tech:farah,days:32,offset:23,service:'repair',note:'Condensate pump runs noisily and does not clear water reliably.'},
    {owner:evelyn,address:evelynHome,tech:chris,days:110,offset:24,service:'cleaning',note:'Quarterly household cleaning; check airflow in the study.'},
  ];
  for(const item of otherScenarios) {
    const repairVisit=item.service==='repair';
    single(`${item.owner.key}-history`,item.address,item.service,dates.past(item.days),'Completed',item.note,
      {tech:item.tech,window:'afternoon',duration:repairVisit?95:50+item.address.unitIds.length*15,
        work:repairVisit?'Isolated the unit, tested pump switching and discharge flow, fitted a compatible condensate pump and checked the safety switch.':'Washed reusable filters, removed surface dust, flushed drain lines and tested fan speeds and cooling.',
        findings:repairVisit?'Pump impeller intermittently stalled and water remained in the collection tray.':'Normal household dust build-up; drain lines and electrical connections were serviceable.',
        solution:repairVisit?'Replaced the faulty pump and verified automatic start/stop through repeated drain cycles.':'Completed routine cleaning and confirmed stable cooling and clear condensate drainage.',
        ...(repairVisit?{parts:[['Condensate Pump',1],['Cable Tie',2]]}:{})});
    single(`${item.owner.key}-assigned`,item.address,'cleaning',dates.future(item.offset),'Assigned','Scheduled routine cleaning. Please call on arrival and inspect every indoor unit.',{tech:item.tech,window:'afternoon'});
    single(`${item.owner.key}-submitted`,item.address,'repair',dates.future(item.offset+18),'Submitted','One indoor unit is slower to cool than the others. Please assess the cause and provide a quote before additional work.');
  }
  const aliceSeries=series.find(row=>row.key==='alice-annual');
  const aliceVisits=plans.filter(plan=>plan.annual===aliceSeries);
  if(aliceVisits.filter(plan=>plan.date<asOf).length!==2||aliceVisits.slice(2).some(plan=>plan.date<addCalendarDays(asOf,14)))throw new Error('Alice annual scenario must have two completed and two valid future visits.');
  for(const plan of plans) {
    if(!isWeekday(plan.date))throw new Error(`Weekend scenario visit: ${plan.key}`);
    if(!['Completed','Cancelled'].includes(plan.status)&&plan.date<addCalendarDays(asOf,14))throw new Error(`Insufficient future notice: ${plan.key}`);
  }
  // Allocate alternate technicians if two generated anchors land on the same
  // date/window. No current-day jobs are invented merely to fill the dashboard.
  const reservations=new Set();
  for(const plan of [...plans].sort((a,b)=>a.date.localeCompare(b.date)))if(plan.tech) {
    const available=[plan.tech,...technicians.filter(tech=>tech!==plan.tech)].find(tech=>!reservations.has(`${tech.technicianId}|${plan.date}|${plan.window}`));
    if(!available)throw new Error(`No non-overlapping route for ${plan.key}.`);
    plan.tech=available;reservations.add(`${available.technicianId}|${plan.date}|${plan.window}`);
  }
  for(const plan of [...plans].sort((a,b)=>a.date.localeCompare(b.date))) {
    const window=timeWindows[plan.window],owner=plan.address.owner;
    const requestId=plan.annual?(plan.visit.visitNumber===1?plan.annual.requestId:null):randomUUID();
    const selection=plan.selection??await resolveBookingSelection(connection,owner.customerId,{serviceId:(plan.serviceCode==='cleaning'?cleaning:repair).serviceId,requestId},plan.address.unitIds.length);
    const amount=plan.visit?.totalAmount??selection.totalAmount;
    const createdAt=plan.createdAt??sqlUtc(plan.status==='Completed'||(plan.status==='Cancelled'&&plan.date<asOf)?previousWeekday(addCalendarDays(plan.date,-24)):dates.past(7));
    const confirmedAt=sqlUtc(plan.status==='Completed'?previousWeekday(addCalendarDays(plan.date,-18)):dates.past(5),'11:00:00');
    const assignedAt=sqlUtc(plan.status==='Completed'?previousWeekday(addCalendarDays(plan.date,-14)):dates.past(3),'11:30:00');
    const start=plusMinutes(sqlUtc(plan.date,window.start),5),end=plusMinutes(start,plan.duration??90);
    const cancelledAt=sqlUtc(plan.date<asOf?previousWeekday(addCalendarDays(plan.date,-5)):dates.past(2),'15:00:00');
    const updatedAt=plan.status==='Completed'?end:plan.status==='Cancelled'?cancelledAt:plan.status==='Assigned'?assignedAt:plan.status==='Confirmed'?confirmedAt:createdAt;
    const slotEnd=plusMinutes(`${plan.date} ${window.start}`,120).slice(11,19);
    const [inserted]=await connection.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,problem_description,booking_status,total_amount,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[owner.customerId,plan.address.addressId,selection.services[0].serviceId,plan.date,window.label,window.start,slotEnd,plan.notes,plan.status,amount,createdAt,updatedAt]);
    const row={key:plan.key,bookingId:inserted.insertId,customerId:owner.customerId,addressId:plan.address.addressId,status:plan.status,date:plan.date,totalAmount:amount,service:plan.serviceCode};bookings.push(row);
    for(const unitId of plan.address.unitIds)await connection.execute('INSERT INTO booking_aircon_unit(booking_id,unit_id) VALUES (?,?)',[row.bookingId,unitId]);
    await connection.execute('INSERT INTO web_booking_details(booking_id,service_package,contact_phone,special_notes,request_id) VALUES (?,?,?,?,?)',
      [row.bookingId,selection.package?.name||selection.serviceName,owner.phone||null,plan.notes,requestId]);
    await saveBookingSelection(connection,row.bookingId,{...selection,totalAmount:amount,services:selection.services.map(service=>({...service,lineTotal:amount}))});
    if(plan.annual) {
      await connection.execute('INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,?)',
        [row.bookingId,plan.annual.seriesId,plan.visit.visitNumber,plan.date,plan.visit.windowStart,plan.visit.windowEnd]);
      plan.annual.visits.push({bookingId:row.bookingId,visitNumber:plan.visit.visitNumber,preferredDate:plan.date,status:plan.status,totalAmount:amount});
    }
    const history=[{old:null,status:'Submitted',actor:owner.userId,at:createdAt,note:'Customer submitted a service request. Appointment awaiting confirmation.'}];
    if(['Confirmed','Assigned','Completed'].includes(plan.status))history.push({old:'Submitted',status:'Confirmed',actor:mei.userId,at:confirmedAt,note:'Preferred service date and arrival window confirmed with the customer.'});
    if(plan.tech) {
      history.push({old:'Confirmed',status:'Assigned',actor:norshida.userId,at:assignedAt,note:`Assigned to ${plan.tech.name} for the planned service route.`});
      const [assignment]=await connection.execute('INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status,assigned_at,updated_at) VALUES (?,?,?,?,?,?)',
        [row.bookingId,plan.tech.technicianId,norshida.userId,plan.status==='Completed'?'Completed':'Accepted',assignedAt,updatedAt]);
      assignments.push({assignmentId:assignment.insertId,bookingId:row.bookingId,technicianId:plan.tech.technicianId});
      const [job]=await connection.execute(`INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,priority_level,reported_problem,current_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,[row.bookingId,assignment.insertId,`${plan.date} ${window.start}`,window.start,plan.serviceCode==='repair'?'High':'Normal',plan.notes,plan.status==='Completed'?'Completed':'Assigned',assignedAt,updatedAt]);
      const jobRow={jobId:job.insertId,bookingId:row.bookingId,technicianId:plan.tech.technicianId,status:plan.status,date:plan.date,time:window.start,plan,start,end};jobs.push(jobRow);
      if(plan.status==='Completed') {
        history.push({old:'Assigned',status:'On The Way',actor:plan.tech.userId,at:plusMinutes(start,-35),note:'Technician travelling to the confirmed service address.'},
          {old:'On The Way',status:'In Progress',actor:plan.tech.userId,at:start,note:'Arrived, confirmed the scope and started the service.'},
          {old:'In Progress',status:'Completed',actor:plan.tech.userId,at:end,note:'Service completed and findings recorded in the maintenance report.'});
        // Existing report DATETIME fields represent Singapore wall-clock time;
        // submitted_time is a TIMESTAMP and remains UTC on this connection.
        const reportStart=plusMinutes(start,480),reportEnd=plusMinutes(end,480);
        const [report]=await connection.execute(`INSERT INTO service_report(job_id,work_performed,problem_found,solution_applied,checklist_result,submitted_time,started_at,completed_at)
          VALUES (?,?,?,?,?,?,?,?)`,[job.insertId,plan.work,plan.findings,plan.solution,'Power isolation checked; filters inspected; drain flow tested; fan controls tested; cooling checked; work area left clean.',plusMinutes(end,5),reportStart,reportEnd]);
        reports.push({reportId:report.insertId,jobId:job.insertId,bookingId:row.bookingId,durationMinutes:plan.duration,startedAt:reportStart,completedAt:reportEnd});
        if(plan.serviceCode==='cleaning') {
          const note='Regular cleaning selected after inspecting coil surfaces, filter condition and condensate drainage. No chemical overhaul was required for this visit.';
          const assessedAt=plusMinutes(start,5),assessmentRequest=randomUUID();
          await connection.execute('INSERT INTO work_order_cleaning_assessment(job_id,cleaning_method,assessment_note,version,assessed_by_user_id,created_at,updated_at) VALUES (?,\'Regular\',?,1,?,?,?)',
            [job.insertId,note,plan.tech.userId,assessedAt,assessedAt]);
          await connection.execute(`INSERT INTO work_order_cleaning_assessment_revision(request_id,payload_hash,job_id,changed_by_user_id,before_method,after_method,before_note,after_note,before_version,after_version,changed_at)
            VALUES (?,?,?,?,NULL,'Regular',NULL,?,0,1,?)`,[assessmentRequest,hash({requestId:assessmentRequest,expectedVersion:0,method:'Regular',note,technicianUserId:plan.tech.userId,jobId:job.insertId}),job.insertId,plan.tech.userId,note,assessedAt]);
          assessments.push({jobId:job.insertId,method:'Regular',version:1});
        }
      }
    }
    if(plan.status==='Cancelled') {
      history.push({old:'Submitted',status:'Cancelled',actor:owner.userId,at:cancelledAt,note:plan.cancelReason});
      await connection.execute('INSERT INTO booking_change_request(booking_id,request_type,reason,request_status,created_at) VALUES (?,\'Cancel\',?,\'Approved\',?)',[row.bookingId,plan.cancelReason,cancelledAt]);
    }
    for(const event of history)await connection.execute('INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note,changed_at) VALUES (?,?,?,?,?,?)',
      [row.bookingId,event.old,event.status,event.actor,event.note,event.at]);
  }

  // The final stock is derived exclusively from these receipts, issues and
  // returns. Only the pump and motor are deliberately below the current 15-unit
  // dashboard threshold; quantities and per-AC recommendations remain distinct.
  const opening={
    'Aircon Filter':40,'Drain Hose':80,'Capacitor 35uF':25,'Coil Cleaner (500 mL)':60,'Insulation Tube (1 m)':60,
    'Drain Elbow':35,'Cable Tie':200,'Refrigerant R32 (1 kg)':18,'Condensate Pump':8,'Fan Motor':5,'Temperature Sensor':22,
  };
  const stocks=new Map(parts.map(part=>[part.part_id,0]));
  const openingDate=previousWeekday(addCalendarDays([...plans].sort((a,b)=>a.date.localeCompare(b.date))[0].date,-35));
  const movements=[];
  for(const [index,part] of parts.entries())movements.push({kind:'Stock In',part,quantity:opening[part.part_name]??30,
    at:plusMinutes(sqlUtc(openingDate,'09:00:00'),index*3),actor:norshida,job:null,remarks:`Opening warehouse receipt: ${part.part_name}. Count checked against the delivery note.`,correct:part.part_name==='Drain Hose'});
  for(const job of jobs.filter(item=>item.status==='Completed')) {
    const usages=job.plan.parts??(job.plan.serviceCode==='cleaning'?[['Coil Cleaner (500 mL)',1]]:[]);
    for(const [name,quantity] of usages)movements.push({kind:'Stock Out',part:partNamed(name),quantity,at:plusMinutes(job.start,-40),actor:job.plan.tech,job,
      remarks:name==='Coil Cleaner (500 mL)'?'Routine cleaning consumable issued for this work order; apply according to product directions.':`Issued for the diagnosed repair: ${name}. See the service report for work performed.`});
    for(const [name,quantity] of job.plan.returns??[])movements.push({kind:'Return',part:partNamed(name),quantity,at:plusMinutes(job.end,25),actor:mei,job,
      remarks:'Unused material returned after the work order. Sealed or serviceable condition checked before restocking.'});
  }
  for(const movement of movements.sort((a,b)=>a.at.localeCompare(b.at))) {
    const before=stocks.get(movement.part.part_id),originalQuantity=movement.correct?movement.quantity-2:movement.quantity;
    const sign=movement.kind==='Stock Out'?-1:1,delta=sign*originalQuantity,after=before+delta;
    if(after<0)throw new Error('Scenario inventory cannot become negative.');
    const adminId=movement.actor.role==='Admin'?movement.actor.userId:null;
    const [inserted]=await connection.execute(`INSERT INTO inventory_transaction(job_id,part_id,transaction_type,quantity,remarks,admin_user_id,performed_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`,[movement.job?.jobId??null,movement.part.part_id,movement.kind,originalQuantity,movement.remarks,adminId,movement.actor.userId,movement.at]);
    const requestId=randomUUID();
    await connection.execute('INSERT INTO inventory_web_operation(request_id,payload_hash,transaction_id,stock_before,stock_delta,stock_after) VALUES (?,?,?,?,?,?)',
      [requestId,hash({part_id:movement.part.part_id,transaction_type:movement.kind,quantity:originalQuantity,job_id:movement.job?.jobId??null,remarks:movement.remarks,expected_stock:before,admin_user_id:adminId,technician_user_id:adminId?null:movement.actor.userId}),inserted.insertId,before,delta,after]);
    stocks.set(movement.part.part_id,after);
    if(movement.correct) {
      const changedAt=plusMinutes(movement.at,15),remarks='Opening warehouse receipt corrected from 78 to 80 metres after checking the final sealed hose coil.';
      const correctionRequest=randomUUID(),stockAfter=after+2;
      await connection.execute(`INSERT INTO inventory_transaction_revision(request_id,payload_hash,transaction_id,changed_by_user_id,before_quantity,after_quantity,before_occurred_at,after_occurred_at,
        before_remarks,after_remarks,before_version,after_version,stock_before,stock_delta,stock_after,changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,2,?,2,?,?)`,
        [correctionRequest,hash({request_id:correctionRequest,expected_version:1,quantity:movement.quantity,occurred_at:movement.at,remarks,transactionId:inserted.insertId,adminId:mei.userId}),inserted.insertId,mei.userId,originalQuantity,movement.quantity,movement.at,movement.at,movement.remarks,remarks,after,stockAfter,changedAt]);
      await connection.execute('UPDATE inventory_transaction SET quantity=?,remarks=?,version=2,modified_at=? WHERE transaction_id=?',[movement.quantity,remarks,changedAt,inserted.insertId]);
      stocks.set(movement.part.part_id,stockAfter);inventoryRevisions.push({transactionId:inserted.insertId,beforeQuantity:originalQuantity,afterQuantity:movement.quantity,version:2});
    }
    inventory.push({transactionId:inserted.insertId,partId:movement.part.part_id,type:movement.kind,quantity:movement.quantity,jobId:movement.job?.jobId??null});
  }
  for(const part of parts)await connection.execute('UPDATE part SET current_stock=? WHERE part_id=?',[stocks.get(part.part_id),part.part_id]);
  return {asOf,fictional:true,accounts:accounts.map(({phone,...row})=>row),
    customerIds:customerAccounts.map(user=>user.customerId),technicianIds:technicians.map(user=>user.technicianId),
    addresses:addresses.map(({owner,unitIds,...row})=>({...row,unitCount:unitIds.length})),units,bookings,annualSeries:series,
    assignments,workOrders:jobs.map(({plan,start,end,...row})=>row),reports,cleaningAssessments:assessments,inventoryTransactions:inventory,inventoryRevisions,
    stock:parts.map(part=>({partId:part.part_id,name:part.part_name,quantity:stocks.get(part.part_id),unit:part.stock_unit})),
    counts:{customers:customerAccounts.length,technicians:technicians.length,addresses:addresses.length,units:units.length,bookings:bookings.length,
      statuses:Object.fromEntries([...new Set(bookings.map(row=>row.status))].map(status=>[status,bookings.filter(row=>row.status===status).length])),
      annualSeries:series.length,workOrders:jobs.length,reports:reports.length,cleaningAssessments:assessments.length,inventoryTransactions:inventory.length,inventoryRevisions:inventoryRevisions.length}};
}
