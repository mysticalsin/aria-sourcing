Aria Recruitment
================

Odoo 19 Community addon for the Smart per-need pipeline on ``hr_recruitment``.

The shared stage spec is ``spec/pipeline_stages.json``. Stage rows and the
state machine are generated from that file.

Hired is refused unless a contract document is attached and the DNA adapter
returns ``integrated`` or ``complete``. The built-in adapter is fake and does
not call a network. Every attempt writes an append-only audit row and a
chatter note.

Run the tests from the repository root::

    bash odoo_addons/aria_recruitment/ci/run.sh
