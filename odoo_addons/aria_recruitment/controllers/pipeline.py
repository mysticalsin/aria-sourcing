"""Public pipeline page for the recruitment addon.

Names the stage list and the GDPR controls. It does not list applicants.
"""

from odoo import http
from odoo.http import request


class AriaPipelineController(http.Controller):
    @http.route("/aria/pipeline", type="http", auth="public", methods=["GET"], csrf=False)
    def pipeline(self, **_kwargs):
        body = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Aria pipeline</title></head>
<body>
<h1>Aria recruitment pipeline</h1>
<p>Stages run to rate, to assess, to interview, shoot, qm, to hire, then the Hired gate.</p>
<h2>GDPR</h2>
<p>A GDPR opt-out blocks further outreach and is audited.</p>
<p>Erasure removes personal data and leaves an audit row.</p>
</body>
</html>
"""
        return request.make_response(body, headers=[("Content-Type", "text/html; charset=utf-8")])
