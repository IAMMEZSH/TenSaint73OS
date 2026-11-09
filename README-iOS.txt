TenSaint73OS · iPhone / iPad Installation Guide
===============================================

To be clear: this is not an IPA. iOS cannot install an APK, and an APK cannot
be "converted" into an IPA. A real IPA must be compiled on macOS with Xcode and
signed with an Apple identity; that cannot be done on Windows. This package
makes the Node.js server and web console runnable on iOS: iSH (free on the App
Store) runs Node on the iPhone, Safari opens the console, and Add to Home Screen
gives it an app-like icon and full-screen presentation.

A. On-device mode (iSH, entirely inside the phone sandbox)
----------------------------------------------------------
1. Install iSH from the App Store.
2. Transfer TenSaint73OS-iPhone-iSH.zip to the phone (either method):
   - iCloud Drive / OneDrive: put the zip where the Files app can see it, then
     in iSH:
       mkdir -p ~/ios
       mount -t ios . ~/ios        # a directory picker opens; choose the zip folder
   - Same Wi-Fi as a computer: in the zip folder on the computer run
       python -m http.server 8899
     then in iSH:
       wget http://COMPUTER-LAN-IP:8899/TenSaint73OS-iPhone-iSH.zip
3. Unpack and start with one command (recommended):
     cd ~
     apk add --no-cache unzip
     unzip TenSaint73OS-iPhone-iSH.zip -d ~
     sh ~/启动-TenSaint73OS-iPhone.sh
   The launcher installs Node.js automatically (network needed the first time)
   and starts the service. Manual steps are also supported:
     cd ~/TenSaint73OS
     sh ios-install.sh          # once only; installs nodejs / npm
     sh ios-start.sh
4. After "core online" appears, switch to Safari and open:
     http://127.0.0.1:7373
   This public package is member-only: press Register on the login page to
   create an ordinary member. Each account receives an isolated encrypted file
   directory and private database; members cannot see each other. No
   administrator is built in, and registration cannot grant the admin role.
   The instance owner can export a .tsowner from the original device, register
   its fingerprint once, and import it on this install:
     sh owner/fingerprint-owner-key.sh "/path/to/your.tsowner"
     sh owner/import-owner-key.sh
   The first command writes owner/OWNER.pin; while it is missing every import
   is refused. The pin is portable and holds no credentials. The key is
   accepted only when it matches the pin, then sign in with the original
   password plus the bound phone.
   After signing in, use Safari Share -> Add to Home Screen.
   That home-screen icon is the iPhone launcher: on later sessions run the
   one-command launcher first, then tap the icon.

Note: iOS suspends iSH when you switch to Safari, and the service may pause.
An optional community workaround (battery-intensive and not guaranteed on every
iOS version):
  First grant iSH "While Using the App" under Settings -> Privacy & Security ->
  Location Services, then in iSH run:
     sh ios-keepalive.sh
  and switch to Safari. Return to iSH and press Ctrl+C to stop the keep-alive.
  Keep iSH in the foreground for active use.

Other platforms (Android / Linux / Windows) are outside this guide; see the
package's Start Here document.

B. Hosted on a computer (most stable; recommended for long-term use)
-------------------------------------------------------------------
On Windows, double-click TenSaint73OS-Launcher.exe in the package root. The
launcher starts the service and opens the browser. It bundles runtime\node.exe,
so Node.js does not need to be installed separately. The phone browser uses the
tunnel address by default (see below); no LAN port exposure is required.

Only for temporary direct access on the same trusted LAN:
  cd TenSaint73OS
  TS_BIND=0.0.0.0 node server.js
Then open http://COMPUTER-LAN-IP:7373 in Safari.
This is plain HTTP and exposes the service to the whole subnet. Use it briefly
on a trusted network only. Public access must use the HTTPS tunnel; never map
port 7373 to the Internet. If Windows Firewall asks, allow the private network
only.
When the computer shuts down or sleeps, the tunnel and page stop; data remains
in the computer's data directory.
Start the tunnel from the administrator console under Network Matrix -> Tunnel
Control, or run run-online.sh (cloudflared Quick Tunnel).
Install tunnel component also works inside iSH: it downloads the linux-386
build, runs a self-check, starts the tunnel and displays the HTTPS hostname
allocated by Cloudflare for this process. If iSH cannot run cloudflared, start
the tunnel on a Windows or Linux computer instead.
After replacing or upgrading program files, fully exit node in iSH and start it
again.

Data and security
-----------------
- Multi-user isolation: the administrator controls the global database; each
  member has a separate data/users/<hash>.db and data/files/users/<workspace>/
  directory. The API checks ownership on every request and refuses escapes.
- Registration is open by default; the administrator can close it at any time
  under Settings -> User registration. Passwords are at least 8 characters.
- Optional security phone: bind it under Account Security; sign-in then
  requires both the password and the number. The number is stored separately
  with AES-256-GCM, using a key derived from install.salt, independent of the
  login password. Only the account owner can retrieve the complete number via
  /api/me/phone; the admin UI shows only "bound". Changing or unbinding requires
  the password plus the current number and revokes sessions on other devices.
- The public package contains no administrator account and no real database.
  The first start creates empty encrypted storage. The supreme administrator is
  established only by importing an encrypted .tsowner owner key whose
  fingerprint matches owner/OWNER.pin (sh owner/import-owner-key.sh), or by
  keeping an auth vault that already contains the administrator from a previous
  version. The program never generates administrator credentials.
- After a run, data/ contains the encrypted auth vault, databases and
  install.salt. Do not upload it to public storage or group chats. Back up
  install.salt together with the databases.
- The default port is 7373 and the server binds 127.0.0.1 only. LAN access
  requires an explicit TS_BIND=0.0.0.0, with the plain-HTTP risk on you.
- Do not run unknown scripts inside iSH. This project has zero npm
  dependencies; ios-install.sh installs only the Alpine packages nodejs, npm
  and unzip.

Known limits
------------
- No systemd, no Docker: this is Alpine + Node, not a real Ubuntu.
- iSH is an x86 emulator, so crypto and page responses are slower than a
  computer. The data volume is small, so it remains usable.
- iOS suspends iSH in the background and the tunnel disconnects with it.
  Therefore iPhone/iSH is not recommended as a long-running tunnel host.
  cloudflared is not guaranteed to run inside iSH.
  Recommended: run the tunnel on a Windows or Linux host that stays powered on,
  and use Safari on the iPhone to open that address.
- The phone UI already has a narrow-screen layout (the sidebar becomes a top
  horizontal navigation bar); iPad landscape is the better experience.
