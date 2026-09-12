import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm,symlink,unlink,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolveReportPhoto,reportPhotoDirectory} from './report-photos.mjs';

test('report photo resolution allows private images and rejects remote URLs, traversal and missing illustrative files',async()=>{
  const filename=`test-${randomUUID()}.png`;
  const path=join(reportPhotoDirectory,filename);
  await mkdir(reportPhotoDirectory,{recursive:true});
  await writeFile(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7z0AAAAASUVORK5CYII=','base64'));
  try {
    assert.equal(await resolveReportPhoto(filename),path);
    assert.equal(await resolveReportPhoto('uploads/'+filename),path);
    for(const invalid of ['https://example.com/image.png','http://127.0.0.1/private.png','../../.env.local','../outside.png','/absolute.png','C:\\private.png','test.svg',filename+'?download=true','missing-'+filename])assert.equal(await resolveReportPhoto(invalid),null,invalid);
  }finally{await rm(path,{force:true});}
});

test('report photo resolution rejects a directory link escaping the private photo root',async()=>{
  const id=randomUUID();
  const outside=resolve(reportPhotoDirectory,'..','photo-test-'+id);
  const junction=join(reportPhotoDirectory,'linked-'+id);
  const image=join(outside,'outside.png');
  await mkdir(reportPhotoDirectory,{recursive:true});
  await mkdir(outside);
  await writeFile(image,'private test bytes');
  let linked=false;
  try {
    await symlink(outside,junction,'junction');linked=true;
    assert.equal(await resolveReportPhoto('linked-'+id+'/outside.png'),null);
  }finally {
    if(linked)await unlink(junction);
    await rm(image,{force:true});
    await rmdir(outside);
  }
});
