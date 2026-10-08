# Reading and changing data in the deployed app

Your project is deployed as a running application with its own database. These
commands call that application's admin API as the project owner, so you can look
at real data and fix it. Dreamy holds the credential and opens the session; you
never see or need a password, token, or AWS key.

Run the commands exactly as written. The task id is already filled in.

List the records of a model:

    {command} /api/admin/users/

Filter, sort, and page with `--query` (a query string or a JSON object):

    {command} /api/admin/loans/ --query 'filter{status}=overdue&sort=-due_date&page.size=20'
    {command} /api/admin/loans/ --query '{"include[]": ["id", "amount"], "page": 2}'

Read one record:

    {command} /api/admin/loans/<id>/

Change one record, or create one:

    {command} /api/admin/loans/<id>/ --method PATCH --data '{"data": {"status": "paid"}}'
    {command} /api/admin/loans/ --method POST --data-file new-loan.json

Notes:

- Paths must begin with `/api/admin/`. The trailing slash matters.
- `--stage dev` is the default; pass `--stage production` only when the request
  is explicitly about production data.
- The call fails with a clear message if that environment is not deployed yet.
- Every call is recorded in the user's activity log, so treat production writes
  as you would a change you cannot take back: read first, then change.
- This is for the app's *data*, which includes role records
  (`/api/admin/roles/`, a `name` and a `permissions` map per resource and
  operation) and the `roles` a user holds (`/api/admin/users/<id>/` with
  `--method PATCH --data '{"roles": ["<role id>"]}'`). To change the app's
  models, hooks, tasks, or grants in code, edit the files in the checkout.
