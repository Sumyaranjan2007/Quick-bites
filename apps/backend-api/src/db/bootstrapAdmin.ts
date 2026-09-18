/**
 * The one administrator the platform starts with.
 *
 * Every other account on a live platform arrives by self-registration: a
 * customer verifies a phone number, a restaurant or a rider signs up and waits
 * to be approved. Somebody has to do the approving, and that account cannot
 * approve itself into existence — so exactly one is created from the
 * deployment's own environment.
 *
 * This replaces `SEED_DEFAULT_PASSWORD`, which was a shared password for four
 * seeded accounts held in one deployment's environment and nowhere else. It is
 * why the staff apps could not be handed to testers at all: nobody outside that
 * environment could sign in, and the value was not readable from the machine the
 * builds were made on.
 *
 * Three properties matter here:
 *
 * PRODUCTION REFUSES TO START WITHOUT IT. Coming up with no way in is not a
 * safer failure than refusing to boot — it is the same failure, discovered
 * later and usually by a customer.
 *
 * NO DEFAULT PASSWORD, EVER. Falling back to a built-in value in a public
 * repository publishes the credential to the platform's administration.
 *
 * IT RE-APPLIES ON EVERY BOOT. That is the documented recovery path for a
 * locked-out administrator: change `ADMIN_PASSWORD` on the host, redeploy, sign
 * in. There is deliberately no self-service reset for the account that can
 * approve every partner and rider on the platform.
 */
import bcrypt from 'bcryptjs';
import { config } from '../config/env.ts';
import { userRepository } from './repositories/userRepository.ts';
import { adminRoleRepository } from './repositories/adminRoleRepository.ts';
import { triggerAutoSave } from './client.ts';
import type { UserRole } from '@quick-bites/shared-types';

export async function ensureBootstrapAdmin(): Promise<void> {
  const email = config.ADMIN_EMAIL.trim().toLowerCase();
  const password = config.ADMIN_PASSWORD;

  if (!email || !password) {
    if (config.IS_PRODUCTION) {
      throw new Error(
        'ADMIN_EMAIL and ADMIN_PASSWORD are not set. Refusing to start: a production ' +
          'platform with no administrator cannot approve a single restaurant or rider, ' +
          'and there is no other way to create one.'
      );
    }
    console.log('[INFO] No ADMIN_EMAIL/ADMIN_PASSWORD set. Skipping bootstrap admin (development only).');
    return;
  }

  if (password.length < 10 && config.IS_PRODUCTION) {
    throw new Error(
      'ADMIN_PASSWORD is shorter than 10 characters. Refusing to start: this is the ' +
        'credential for the account that can approve every partner and rider, read every ' +
        'order, and refund any payment.'
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await userRepository.findByEmail(email);

  if (existing) {
    // Re-applied rather than left alone, because this is the recovery path: an
    // administrator who has lost access changes the variable and redeploys.
    await userRepository.update(existing.id, {
      passwordHash,
      role: 'super_admin' as UserRole,
      // Without a role assignment the account authenticates and then fails every
      // permission check, which reads as a broken console rather than a missing
      // grant. `ensureSystemRoles()` creates the role itself at boot.
      adminRoleId: 'rol_super_admin',
      isBlocked: false
    } as any);
    console.log(`[INFO] Bootstrap administrator re-applied for ${email}.`);
  } else {
    await userRepository.create({
      id: `usr_admin_bootstrap_${Date.now().toString(36)}`,
      email,
      passwordHash,
      fullName: 'Platform Administrator',
      role: 'super_admin' as UserRole,
      // The role that holds every permission, including handing roles to others.
      adminRoleId: 'rol_super_admin',
      isGold: false,
      preferredLanguage: 'en'
    } as any);

    console.log(`[INFO] Bootstrap administrator created for ${email}.`);
  }

  triggerAutoSave();
}
