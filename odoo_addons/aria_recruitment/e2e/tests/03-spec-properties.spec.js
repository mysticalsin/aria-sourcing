const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { state, json2, pdfBase64 } = require('../lib/odoo');

const spec = JSON.parse(fs.readFileSync(process.env.SPEC_PATH, 'utf8'));

function edge(from, to) {
  const stage = spec.stages.find((item) => item.key === from);
  return (stage.transitions || []).find((item) => item.to === to) || null;
}

async function createAt(stageKey, name) {
  const created = await json2('manager', 'hr.applicant', 'create', {
    vals_list: [{
      partner_name: name,
      email_from: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`,
      job_id: state.job_id,
      stage_id: state.stage_ids[stageKey],
    }],
  });
  expect(created.ok, created.message).toBeTruthy();
  return Array.isArray(created.result) ? created.result[0] : created.result;
}

async function stageOf(id) {
  const read = await json2('manager', 'hr.applicant', 'read', {
    ids: [id],
    fields: ['stage_id'],
  });
  expect(read.ok, read.message).toBeTruthy();
  return read.result[0].stage_id[0];
}

test('verifier property: every stage pair matches the spec', async () => {
  test.setTimeout(300000);
  const keys = spec.stages.map((stage) => stage.key);
  const failures = [];
  for (const from of keys) {
    for (const to of keys) {
      if (from === to) continue;
      let id;
      if (from === 'hired') {
        id = await createAt('to_hire', `Prop ${from} ${to}`);
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
        const hired = await json2('manager', 'hr.applicant', 'write', {
          ids: [id],
          vals: { stage_id: state.stage_ids.hired },
        });
        expect(hired.ok, hired.message).toBeTruthy();
      } else if (from === 'rejected' || from === 'withdrawn') {
        id = await createAt('to_rate', `Prop ${from} ${to}`);
        const moved = await json2('manager', 'hr.applicant', 'write', {
          ids: [id],
          vals: { stage_id: state.stage_ids[from] },
        });
        expect(moved.ok, moved.message).toBeTruthy();
      } else {
        id = await createAt(from, `Prop ${from} ${to}`);
      }
      const attempt = await json2('manager', 'hr.applicant', 'write', {
        ids: [id],
        vals: { stage_id: state.stage_ids[to] },
      });
      const link = edge(from, to);
      const guard = Boolean(link && link.guard);
      const expectAllow = Boolean(link) && !guard;
      const stayed = await stageOf(id);
      if (expectAllow) {
        if (!attempt.ok || stayed !== state.stage_ids[to]) {
          failures.push(`${from}->${to} should be allowed`);
        }
      } else if (attempt.ok || stayed === state.stage_ids[to]) {
        failures.push(`${from}->${to} should be refused`);
      }
    }
  }
  expect(failures, failures.join('; ')).toEqual([]);
});

test('boundary: hired is refused with no contract', async () => {
  const id = await createAt('to_hire', 'Boundary None');
  const attempt = await json2('manager', 'hr.applicant', 'write', {
    ids: [id],
    vals: { stage_id: state.stage_ids.hired },
  });
  expect(attempt.ok).toBeFalsy();
  expect(await stageOf(id)).toBe(state.stage_ids.to_hire);
});

test('boundary: hired is refused when DNA is pending or failed', async () => {
  for (const status of ['pending', 'failed']) {
    const id = await createAt('to_hire', `Boundary ${status}`);
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
      vals: { aria_dna_integration_status: status },
    });
    expect(dna.ok, dna.message).toBeTruthy();
    const attempt = await json2('manager', 'hr.applicant', 'write', {
      ids: [id],
      vals: { stage_id: state.stage_ids.hired },
    });
    expect(attempt.ok).toBeFalsy();
    expect(await stageOf(id)).toBe(state.stage_ids.to_hire);
  }
});

test('boundary: hired is allowed for integrated and complete', async () => {
  for (const status of ['integrated', 'complete']) {
    const id = await createAt('to_hire', `Boundary ${status}`);
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
      vals: { aria_dna_integration_status: status },
    });
    expect(dna.ok, dna.message).toBeTruthy();
    const attempt = await json2('manager', 'hr.applicant', 'write', {
      ids: [id],
      vals: { stage_id: state.stage_ids.hired },
    });
    expect(attempt.ok, attempt.message).toBeTruthy();
    expect(await stageOf(id)).toBe(state.stage_ids.hired);
  }
});

test('boundary: To Rate cannot jump to Hired and Hired has no way out', async () => {
  const fresh = await createAt('to_rate', 'Boundary Jump');
  const jump = await json2('manager', 'hr.applicant', 'write', {
    ids: [fresh],
    vals: { stage_id: state.stage_ids.hired },
  });
  expect(jump.ok).toBeFalsy();
  expect(await stageOf(fresh)).toBe(state.stage_ids.to_rate);
  const hired = await createAt('to_hire', 'Boundary Terminal');
  await json2('manager', 'ir.attachment', 'create', {
    vals_list: [{
      name: 'synthetic-contract.pdf',
      res_model: 'hr.applicant',
      res_id: hired,
      mimetype: 'application/pdf',
      datas: pdfBase64(),
      aria_document_kind: 'contract',
      type: 'binary',
    }],
  });
  await json2('dna', 'hr.applicant', 'write', {
    ids: [hired],
    vals: { aria_dna_integration_status: 'complete' },
  });
  expect((await json2('manager', 'hr.applicant', 'write', {
    ids: [hired],
    vals: { stage_id: state.stage_ids.hired },
  })).ok).toBeTruthy();
  const back = await json2('manager', 'hr.applicant', 'write', {
    ids: [hired],
    vals: { stage_id: state.stage_ids.to_hire },
  });
  expect(back.ok).toBeFalsy();
  expect(await stageOf(hired)).toBe(state.stage_ids.hired);
});
