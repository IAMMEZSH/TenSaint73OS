TenSaint73OS · The Saint Key Protocol · v1.5.0
============================================================

A zero-dependency, fully local encrypted private space:
  - Every member has a separate encrypted database and file workspace.
  - Files and databases are AES-256-GCM sealed before they reach disk.
  - The server binds 127.0.0.1 only; LAN and Internet clients cannot connect
    directly.
  - For public access an administrator starts the outbound cloudflared tunnel
    under Network Matrix -> Tunnel Control.

Platform launch commands are listed in the package's Start Here file:
Windows uses TenSaint73OS-Launcher.exe; Linux, Android (Termux) and
iPhone/iPad (iSH) use the matching launcher script.


1. Roles and permissions
------------------------------------------------------------
- This public package is member-only by default: no administrator is built in,
  and nobody can obtain the supreme role through the web page. It offers three
  actions only: register a member, sign in as a member, delete your own account
  (or end the current session).
- The supreme administrator belongs to the instance owner alone. Admin data
  lives in your own deployment: data/auth.json and data/system.db. It is never
  included in the public download.
- Registration creates an isolated space automatically:
    database  data/users/<hash>.db
    files     data/files/users/<workspace>/
  Member UI and admin console are separate, and members cannot see each other.
- Private spaces are closed to the supreme administrator too. The admin API
  cannot list, read, write or delete member databases and files below
  data/files/users/, cannot read another member's space summary, and cannot
  reset another member's password. Deleting an account destroys its private
  database and every private file; this cannot be undone.
- Members can change their own password, bind a security phone number, and
  permanently delete their own account.


2. Supreme administrator (instance owner only)
------------------------------------------------------------
The administrator account is never printed in the program, generated at startup
or written into the public download. Its username, password and bound phone
exist only inside the encrypted .tsowner owner key held by the instance owner.

To establish the supreme administrator on a device:
  1) Fully exit TenSaint73OS.
  2) Register the owner fingerprint once from the key you trust:
       Windows: owner\Fingerprint-Owner-Key.bat "C:\path\to\your.tsowner"
       Linux / Termux / iSH: sh owner/fingerprint-owner-key.sh "/path/to/your.tsowner"
     This writes owner/OWNER.pin. While it is absent or empty, every import is
     refused. The pin contains only a fingerprint, never a password or phone.
  3) Run owner/import-owner-key (Windows .bat, or sh
     owner/import-owner-key.sh on Linux / Termux / iSH).
  4) Supply the .tsowner path and its passphrase. The key is accepted only when
     its fingerprint matches owner/OWNER.pin, so a self-made key cannot be
     imported. The identity is written into this installation's encrypted auth
     vault; the phone is re-encrypted under this installation's key.
  5) Start TenSaint73OS and sign in with the original administrator password
     plus the bound phone number.

The pin is portable, not tied to one computer: keep owner/OWNER.pin with the
program folder (or commit it with the build) and the same .tsowner imports on
every device of every supported platform. There is no other path. There is no
admin.env, environment variable, console switch, API call or AI command that
creates an administrator. The import is allowed only while this machine has no
administrator, and every other creation path produces an ordinary member. The
administrator password is also the encryption key of data/system.db; losing it
makes the system database unrecoverable.

The Owner Key is created on the original device that already has the
administrator (owner/Export-Owner-Key.bat, or sh owner/export-owner-key.sh):
enter the administrator password, the bound phone number if any, and an
owner-key passphrase of at least 8 characters. The script produces an encrypted
.tsowner file. .tsowner uses AES-256-GCM with scrypt and contains no plaintext
account name or phone number. Keep the file and its passphrase separate. Do not
put them in the software directory or upload them to GitHub.
Identity is portable, but each device keeps its own encrypted data space;
nothing is synchronized automatically.


3. Databases and keys
------------------------------------------------------------
- System database: data/system.db, AES-256-GCM, key derived from the admin
  password with scrypt.
- Member databases: data/users/<sha256(username)>.db, one file per member.
- Install salt: data/install.salt, generated independently per device.
- File integrity: when core files are moved or modified, the next start rotates
  the displayed system key value. That value is a tamper fingerprint, not the
  data encryption key; auth and member data remain readable.
- Backup: stop the service, then copy the whole TenSaint73OS folder. The data
  is already encrypted.
- Important: install.salt + auth.json + system.db must be backed up and moved
  together. Copying only one of them cannot restore the original accounts or
  data.


4. Public access (administrator only)
------------------------------------------------------------
- Local address: http://127.0.0.1:7373
- Remote: sign in as administrator -> Network Matrix -> Tunnel Control ->
  Start tunnel.
  On first use press Install tunnel component once. If the official source is
  unreachable the installer switches to a mirror automatically, downloads large
  files in parallel segments to avoid per-connection throttling, and on Windows
  verifies the Cloudflare digital signature. After a self-check it starts the
  tunnel and displays the address.
  Windows, Linux, Android (Termux), iPhone (iSH) and macOS are supported.
  The tunnel obtains a fresh HTTPS hostname from Cloudflare at runtime and
  publishes it in the platform URL board. Closing the tunnel invalidates that
  hostname immediately; no fixed address is shipped in this package.
- You can also run ./run-online.sh for a command-line tunnel (fixed HTTP/2 +
  IPv4).
- After replacing or upgrading program files, fully exit and restart the
  platform before the page can load the new version.
- Never expose port 7373 as plain HTTP through router port forwarding.


5. Security phone number
------------------------------------------------------------
- Account Security -> bind a security phone. Once bound, sign-in requires both
  the password and that number.
- The number is stored separately with AES-256-GCM, using a key derived from
  install.salt. No plaintext number appears on disk. The administrator user
  list shows only bound / not bound; only the owner of the account can view the
  complete number.


6. Directory layout
------------------------------------------------------------
  TenSaint73OS/
    server.js          core HTTP server
    core/              crypto / database / auth / AI kernels
    public/            web console
    owner/             owner-key export, fingerprint registration and import
    data/              encrypted data, keys, auth vault (created automatically)
    docs/              documentation figures
    screenshots/       console screenshots
    start.sh           Termux / Linux launcher
    run-online.sh      command-line tunnel launcher
    backup.sh          backup helper
    README.md          complete English manual
    README.txt         this quick start
    DEPLOY.txt         Android / Termux deployment details
    README-iOS.txt     iPhone / iPad details


7. Updates and data continuity
------------------------------------------------------------
- A copy that predates the update notice has no network update channel and
  cannot be modified from the outside. To upgrade, extract the new build over
  the same directory while keeping data/ in place, or copy the old data/
  directory into the new folder before the first start.
- Accounts, encrypted tables, member workspaces and tunnel records stay where
  they are. After the upgrade, sign in with the same account and the workspace
  reconnects automatically; no export, import or path remapping is needed.
- Sessions live in memory only, so a restart asks for the password again.
- The tunnel mechanism is unchanged: cloudflared still allocates a fresh
  Cloudflare Quick Tunnel hostname, and the platform publishes whatever URL the
  current process obtained.
- The current build compares itself with the newest published GitHub release
  (one request to the public releases API, cached for an hour, silent when
  offline). When that release is newer and this machine still holds a previous
  deployment (a remembered account or existing data: system database, member
  databases, member workspaces, tunnel record), the update notice appears on
  every page open. A current build is never asked to update itself. Closing it
  hides it for that session only; the next open shows it again, and no browser
  marker can silence it permanently. A brand-new install with no data and no
  remembered account is not interrupted. The official release page is
  https://github.com/IAMMEZSH/TenSaint73OS/releases/latest


8. Reminders
------------------------------------------------------------
- data/ contains the auth vault and encrypted data. Do not upload it to public
  storage or send it to untrusted people.
- The public package contains no real accounts or data. The first run creates
  a new install.salt.
- A member who forgets the password cannot recover it. An administrator who
  forgets the admin password cannot decrypt system.db.
