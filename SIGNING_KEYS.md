# Signing keys — where they live and why they must not be lost

**Read this before running `scripts/build-apks.sh`.**

An Android app is identified by its **package name plus the key that signed
it**. Change either and it stops being the same app: Android refuses to install
the new one over the old one, and every person who has it must uninstall first
— losing their session, and on a released app, their reviews and their install
base.

So these keys are not a build detail. They are the identity of four
applications, and there is exactly one copy of each.

---

## Where they are

| App | Package | Keystore |
| --- | --- | --- |
| Customer | `com.quickbite.app` | `C:\Users\priya\quickbites-keystores\quickbites-customer.jks` |
| Partner | `com.quickbite.partner` | `C:\Users\priya\quickbites-keystores\quickbites-partner.jks` |
| Rider | `com.quickbite.rider` | `C:\Users\priya\quickbites-keystores\quickbites-rider.jks` |
| Admin | `com.quickbite.admin` | `C:\Users\priya\quickbites-keystores\quickbites-admin.jks` |

Each app reads its own `apps/<app>/android/keystore.properties`, which holds
the path, the alias and **two passwords**.

**The copy inside `android/` is disposable. The vault is the source of truth.**

```
C:/Users/priya/quickbites-keystores/
  quickbites-customer-v2.jks    customer.keystore.properties
  quickbites-partner.jks        partner.keystore.properties
  quickbites-rider.jks          rider.keystore.properties
  quickbites-admin.jks          admin.keystore.properties
```

`scripts/build-apks.sh` restores `android/keystore.properties` from that folder
on every build when it is missing - whatever deleted it, and whether or not a
prebuild ran. `QB_KEYSTORE_VAULT` overrides the location.

This replaces the old protection, which took a `mktemp` copy immediately before
prebuild. That was enough only while every prebuild went through the script,
and they do not: running `npx expo prebuild` by hand is the obvious thing to do
while debugging, and it deletes the file with nothing to restore it from. That
is how the customer key's password was lost on 22 Sep 2026 - and the same
deletion happened again on the same day during the Firebase work, recovered
only because a copy had been taken by hand minutes before.

The repair is verified rather than assumed: delete an
`android/keystore.properties` and it comes back byte for byte.

**`apps/<app>/android/` is generated.** `expo prebuild` deletes and recreates
it. A `keystore.properties` inside it is destroyed with everything else, and
because it is gitignored there is nothing in the repository to restore it from
- which is exactly why the vault above sits outside the repository.

---

## Back them up, today, and not on this machine

Four `.jks` files and four `keystore.properties` files. Put them somewhere that
survives this laptop being dropped:

1. **A password manager** — the four passwords, as entries, not in a note file.
2. **An encrypted archive** of the whole `quickbites-keystores` folder plus the
   four properties files, in cloud storage you control.

Do **not** commit any of it. This repository is public.

A lost key cannot be recovered, regenerated or reset by anybody — not by
Google, not by us. The only remedy is a new key, which means a new app.

---

## What happened to the customer key

A build failed with `EBUSY` because a Gradle daemon still held
`apps/customer-mobile/android/.gradle/.../checksums.lock`. Clearing the
directory removed the lock **and `keystore.properties` with it**.

The `.jks` file survived. The password did not, and the apps do not share one,
so it could not be recovered from the other three. A search of the machine
found no other copy.

**The consequence, stated plainly:** the customer app cannot currently be built
as an update to the version already installed. Three of four can. Until the
password is found, the customer app needs a new key, and anyone holding the old
build must uninstall before installing the new one. Nothing is on Play Store
yet, so that is a one-time inconvenience rather than a lost install base — but
it is exactly the harm this document exists to prevent happening twice.

### Restoring it

If the password is found, put it back and nothing else changes:

```bash
mkdir -p "apps/customer-mobile/android"
printf 'storeFile=C:/Users/priya/quickbites-keystores/quickbites-customer.jks\nstorePassword=THE_PASSWORD\nkeyAlias=quickbites-customer\nkeyPassword=THE_PASSWORD\n' > "apps/customer-mobile/android/keystore.properties"
```

If it cannot be found, a replacement key is generated **by the owner** — key
generation is deliberately not something this tooling does:

```bash
"C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot/bin/keytool.exe" \
  -genkeypair -v \
  -keystore "C:/Users/priya/quickbites-keystores/quickbites-customer-v2.jks" \
  -alias quickbites-customer -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "CHOOSE_ONE" -keypass "CHOOSE_ONE" \
  -dname "CN=Quick Bites, OU=customer, O=Quick Bites, L=Bengaluru, ST=Karnataka, C=IN"
```

Then write `keystore.properties` as above, pointing at `-v2.jks`, and record
the password in the password manager **before** building anything.

---

## Which app updates which

From this point on every build is an **update** to what is already installed,
because the package name and the signing key are both unchanged:

| App | Package | Key | Updates in place? |
| --- | --- | --- | --- |
| Customer | `com.quickbite.app` | `quickbites-customer-v2.jks` | Yes, from 22 Sep 2026 |
| Partner | `com.quickbite.partner` | `quickbites-partner.jks` | Yes, always |
| Rider | `com.quickbite.rider` | `quickbites-rider.jks` | Yes, always |
| Admin | `com.quickbite.admin` | `quickbites-admin.jks` | Yes, always |

The customer app required one uninstall when it moved to `-v2` on 22 Sep 2026.
Nobody should ever be asked to uninstall again. **A build signed with a
different key forces every existing user to uninstall and lose their session**,
so the vault is not housekeeping - it is what keeps that promise true.

---

## Before every build

```bash
# 1. All four present? A missing one does not fail the build — it silently
#    falls back to a DEBUG key, and the build still says SUCCESSFUL.
for a in customer-mobile restaurant-mobile delivery-mobile admin-mobile; do
  printf "%-20s %s\n" "$a" \
    "$(test -f apps/$a/android/keystore.properties && echo ok || echo MISSING)"
done

# 2. No Gradle daemon holding a lock. This is what destroyed the last one.
powershell -NoProfile -Command "Get-Process java -ErrorAction SilentlyContinue | Stop-Process -Force"
```

---

## After every build, check the signature — not the exit code

**`scripts/build-apks.sh` does NOT exit 0 on a failed build - but it will look
as though it does if you pipe it.** This file previously claimed the script
swallowed failures. It does not: it runs under `set -euo pipefail` and exits 1.

What actually happens is that `bash scripts/build-apks.sh 2>&1 | tail -25`
reports the exit status of `tail`, which succeeds whatever the build did. On
23 Sep a Gradle failure - the Mapbox SDK could not be downloaded - was reported
as exit code 0 for exactly this reason, and four unchanged APKs from the
previous day sat in `build/apk` looking like a fresh build.

So: run it unpiped, or read `${PIPESTATUS[0]}` rather than `$?`.

```bash
bash scripts/build-apks.sh 2>&1 | tail -25; echo "build exit: ${PIPESTATUS[0]}"
```

The hash comparison below is still the check that matters, for a different
reason: it catches a build that succeeded but produced a stale or identical
artifact, which no exit code can tell you about. A missing
keystore is worse — it produces a complete, installable, **debug-signed** APK
and reports success, and nothing about the file looks wrong until you check.

```bash
AS=$(ls "$ANDROID_HOME/build-tools/" | tail -1)
for f in Customer Partner Rider Admin; do
  printf "%-9s " "$f"
  "$ANDROID_HOME/build-tools/$AS/apksigner.bat" verify --print-certs \
    "build/apk/QuickBites-$f.apk" 2>/dev/null | grep -m1 "DN:"
done
```

Every line must read `CN=Quick Bites`. **`CN=Android Debug` means that APK was
signed with the debug key, will not update the installed app, and must not be
distributed.**

Also compare SHA-256 hashes against the previous set. Four builds where one
silently reused a stale artifact is the failure that looks exactly like
success.
