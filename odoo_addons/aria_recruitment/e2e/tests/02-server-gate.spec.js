const { test, expect } = require('@playwright/test');
const { state, authenticate, callKw, json2, pdfBase64 } = require('../lib/odoo');

async function createAt(stageKey, name) {
  const created = await json2('manager', 'hr.applicant', 'create', {
    vals_list: [{
      partner_name: name,
      email_from: `${name.split(' ')[0].toLowerCase()}.gate@example.test`,
      job_id: state.job_id,
      stage_id: state.stage_ids[stageKey],
    }],
  });
  expect(created.ok, created.message).toBeTruthy();
  const id = Array.isArray(created.result) ? created.result[0] : created.result;
  return id;
}

async function hirePair(id) {
  const contract = await json2('manager', 'ir.attachment', 'create', {
    vals_list: [{
      name: 'synthetic-contract.pdf',
      res_model: 'hr.applicant',
      res_id: id,
      mimetype: 'application/pdf',
      datas: pdfBase64(),
      aria_document_kind: 'contract',
      type: 'binary',
    }],
  });
  expect(contract.ok, contract.message).toBeTruthy();
  const dna = await json2('dna', 'hr.applicant', 'write', {
    ids: [id],
    vals: { aria_dna_integration_status: 'integrated' },
  });
  expect(dna.ok, dna.message).toBeTruthy();
}

test('RPC and JSON-2 refuse a direct write to Hired', async () => {
  const id = await createAt('to_hire', 'Rpc Example');
  const hired = state.stage_ids.hired;
  const session = await authenticate(state.users.manager.login);
  const rpc = await callKw(session, 'hr.applicant', 'write', [[id], { stage_id: hired }]);
  expect(rpc.ok).toBeFalsy();
  expect(rpc.message.toLowerCase()).toContain('hire');
  const viaJson = await json2('manager', 'hr.applicant', 'write', {
    ids: [id],
    vals: { stage_id: hired },
  });
  expect(viaJson.ok).toBeFalsy();
  expect(String(viaJson.message).toLowerCase()).toContain('hire');
  const read = await json2('manager', 'hr.applicant', 'read', {
    ids: [id],
    fields: ['stage_id'],
  });
  expect(read.ok).toBeTruthy();
  expect(read.result[0].stage_id[0]).toBe(state.stage_ids.to_hire);
});

test('date_closed and create_employee_from_applicant are refused', async () => {
  const id = await createAt('to_hire', 'Date Example');
  const session = await authenticate(state.users.manager.login);
  const dated = await callKw(session, 'hr.applicant', 'write', [[id], { date_closed: '2026-11-20 12:00:00' }]);
  expect(dated.ok).toBeFalsy();
  const datedJson = await json2('manager', 'hr.applicant', 'write', {
    ids: [id],
    vals: { date_closed: '2026-11-20 12:00:00' },
  });
  expect(datedJson.ok).toBeFalsy();
  const employee = await callKw(session, 'hr.applicant', 'create_employee_from_applicant', [[id]]);
  expect(employee.ok).toBeFalsy();
  expect(employee.message.toLowerCase()).toContain('hire');
  const employeeJson = await json2('manager', 'hr.applicant', 'create_employee_from_applicant', { ids: [id] });
  expect(employeeJson.ok).toBeFalsy();
});

test('a non-manager cannot set the contract kind over JSON-2', async () => {
  const id = await createAt('to_hire', 'Kind Example');
  const refused = await json2('recruiter', 'ir.attachment', 'create', {
    vals_list: [{
      name: 'synthetic-contract.pdf',
      res_model: 'hr.applicant',
      res_id: id,
      mimetype: 'application/pdf',
      datas: pdfBase64(),
      aria_document_kind: 'contract',
      type: 'binary',
    }],
  });
  expect(refused.ok).toBeFalsy();
  expect(String(refused.message).toLowerCase()).toContain('recruitment manager');
});

test('a user outside the DNA group cannot set DNA status', async () => {
  const id = await createAt('to_hire', 'Dna Example');
  const recruiter = await json2('recruiter', 'hr.applicant', 'write', {
    ids: [id],
    vals: { aria_dna_integration_status: 'integrated' },
  });
  const plain = await json2('plain', 'hr.applicant', 'write', {
    ids: [id],
    vals: { aria_dna_integration_status: 'complete' },
  });
  expect(recruiter.ok).toBeFalsy();
  expect(plain.ok).toBeFalsy();
});

test('the contract is locked after hire except for the system group', async () => {
  const id = await createAt('to_hire', 'Lock Example');
  await hirePair(id);
  const hired = await json2('manager', 'hr.applicant', 'write', {
    ids: [id],
    vals: { stage_id: state.stage_ids.hired },
  });
  expect(hired.ok, hired.message).toBeTruthy();
  const found = await json2('manager', 'ir.attachment', 'search', {
    domain: [
      ['res_model', '=', 'hr.applicant'],
      ['res_id', '=', id],
      ['aria_document_kind', '=', 'contract'],
    ],
  });
  expect(found.ok).toBeTruthy();
  const attachmentId = found.result[0];
  const managerWrite = await json2('manager', 'ir.attachment', 'write', {
    ids: [attachmentId],
    vals: { aria_document_kind: 'other' },
  });
  expect(managerWrite.ok).toBeFalsy();
  const systemWrite = await json2('admin', 'ir.attachment', 'write', {
    ids: [attachmentId],
    vals: { aria_document_kind: 'contract' },
  });
  expect(systemWrite.ok, systemWrite.message).toBeTruthy();
});

test('aria_spec_sync context is ignored over RPC', async () => {
  const stageId = state.stage_ids.to_rate;
  const before = await json2('admin', 'hr.recruitment.stage', 'read', {
    ids: [stageId],
    fields: ['name'],
  });
  const original = before.result[0].name;
  const session = await authenticate(state.users.admin.login);
  const rpc = await callKw(
    session,
    'hr.recruitment.stage',
    'write',
    [[stageId], { name: 'Hacked' }],
    { context: { aria_spec_sync: true, install_mode: true } },
  );
  expect(rpc.ok).toBeFalsy();
  const viaJson = await json2('admin', 'hr.recruitment.stage', 'write', {
    ids: [stageId],
    context: { aria_spec_sync: true, install_mode: true },
    vals: { name: 'Hacked' },
  });
  expect(viaJson.ok).toBeFalsy();
  const after = await json2('admin', 'hr.recruitment.stage', 'read', {
    ids: [stageId],
    fields: ['name'],
  });
  expect(after.result[0].name).toBe(original);
});

test('ir.rule hides other companies and other interview teams', async () => {
  const other = await json2('other', 'hr.applicant', 'search', { domain: [] });
  expect(other.ok, other.message).toBeTruthy();
  expect(other.result).not.toContain(state.applicant_id);
  const team = await json2('interviewer', 'hr.applicant', 'search', { domain: [] });
  expect(team.ok, team.message).toBeTruthy();
  expect(team.result).toContain(state.team_applicant_id);
  expect(team.result).not.toContain(state.applicant_id);
});

test('a multi-record hire write is atomic', async () => {
  const allowed = await createAt('to_hire', 'Allowed Example');
  const blocked = await createAt('to_hire', 'Blocked Example');
  await hirePair(allowed);
  const write = await json2('manager', 'hr.applicant', 'write', {
    ids: [allowed, blocked],
    vals: { stage_id: state.stage_ids.hired },
  });
  expect(write.ok).toBeFalsy();
  const read = await json2('manager', 'hr.applicant', 'read', {
    ids: [allowed, blocked],
    fields: ['stage_id'],
  });
  expect(read.result.map((row) => row.stage_id[0])).toEqual([
    state.stage_ids.to_hire,
    state.stage_ids.to_hire,
  ]);
});
