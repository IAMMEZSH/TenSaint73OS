TenSaint73OS - Owner Key (supreme administrator identity)
==========================================================

Why the public package contains no administrator account
--------------------------------------------------------
The public package on GitHub contains no administrator password, phone number
or auth vault. If administrator credentials were packaged, any downloader could
unpack, brute-force offline or simply impersonate the administrator. That is the
opposite of the goal: the supreme administrator identity stays encrypted.

The correct mechanism is the Owner Key:
- export it once on the device that already has the supreme administrator;
- you get a .tsowner file (AES-256-GCM, passphrase-derived with scrypt);
- register that file in owner/OWNER.pin;
- import the file on any TenSaint73OS installation on any platform;
- sign in as the supreme administrator with the original password plus the
  bound phone number.

The public package on its own only allows registering, signing in and deleting
ordinary members. A member cannot obtain the administrator role, and a build
with an owner pin refuses every key except the registered one.


1. Export (on the original device that has the administrator)
------------------------------------------------------------
Fully exit TenSaint73OS first, including the launcher and any background node
process, then:

Windows:
  double-click owner\Export-Owner-Key.bat
Linux:
  sh owner/export-owner-key.sh
Android (Termux) / iPhone/iPad (iSH):
  sh owner/export-owner-key.sh

Enter, in order: administrator username, administrator password, bound phone
number (if bound), and an Owner Key passphrase of at least 8 characters (typed
twice). The script creates, on the desktop (or in the home directory when no
desktop exists):
  TenSaint73OS-owner-YYYYMMDD-HHMM.tsowner

Security requirements:
- Keep the file and the passphrase separate (for example, file on a USB stick,
  passphrase in a password manager).
- Do not put .tsowner in the software directory, public storage or GitHub.
- A forgotten passphrase cannot be recovered; export again from the original
  device.


2. Register the owner identity (once, from your own .tsowner)
-------------------------------------------------------------
Import is fail-closed: while owner/OWNER.pin is absent or has no pin, every
import is refused. Register the pin from the key file you trust:

Windows:
  owner\Fingerprint-Owner-Key.bat "C:\path\to\TenSaint73OS-owner-....tsowner"
Linux / Termux / iSH:
  sh owner/fingerprint-owner-key.sh "/path/to/TenSaint73OS-owner-....tsowner"
Node.js in any shell:
  node owner/owner-vault.js fingerprint "/path/to/your.tsowner" --write

Enter the Owner Key passphrase. The command writes owner/OWNER.pin:

  OWNER_PIN=<64 lowercase hex characters>

The pin is derived from the key's username + password salt + password hash.
It holds no password, phone number or plaintext. It is portable: it belongs to
the program directory, not to a computer. Commit it with your build (it is not
a secret) and every device running that build accepts that one key file and no
other. A build that ships without a pin refuses all imports.

An existing, different pin is never overwritten. To rotate the owner identity,
move owner/OWNER.pin aside on a machine you control and register the new key.


3. Import (on a fresh device of any platform)
---------------------------------------------
1. Install and unpack the TenSaint73OS package for that platform
   (Windows / Linux / Android / iPhone). Confirm owner/OWNER.pin is present.
2. Do not sign in or register first. If the program is running, fully exit it.
3. Run the import:
   Windows: double-click owner\Import-Owner-Key.bat
   Linux / Termux / iSH: sh owner/import-owner-key.sh
4. Enter the .tsowner path (you can drag the file into the terminal) and the
   Owner Key passphrase.
5. After "supreme administrator identity imported" appears, restart the program
   and sign in with the original password plus the original phone number.

Import compares the key's fingerprint with owner/OWNER.pin. The registered file
works on every platform and every device; a hand-made or foreign .tsowner has a
different fingerprint and is rejected even if its JSON structure is valid.

The import only creates the administrator identity on this machine. It does not
move the original device's files, databases or records. Every device keeps an
independent, encrypted data space. To migrate data as well, copy the original
device's entire data directory separately; install.salt, auth.json and
system.db must all be kept together.


4. Limits and protections
-------------------------
- Import is allowed only while this machine has no supreme administrator. If one
  already exists, the import is refused so it cannot overwrite the account.
- Import does not overwrite an ordinary member with the same name; resolve that
  account first if there is a conflict.
- The phone number is re-encrypted with this installation's key; sign-in still
  requires password plus phone.
- The exported file contains no plaintext username, password or phone number;
  only the encrypted envelope. The pin contains no credentials either.
- This tool performs no network access and uploads nothing to GitHub or any
  third party.
- The passphrase is asked three times per run. If it keeps being rejected,
  switch off the Chinese IME and type it instead of pasting it: pasted text can
  carry invisible control sequences. Add --echo to see what is actually
  captured (the passphrase is then visible on screen), e.g.
  node owner/owner-vault.js fingerprint <file> --echo --write
- The passphrase cannot be recovered. A new file can only be exported from a
  deployment where the administrator account still signs in.
