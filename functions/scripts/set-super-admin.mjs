import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2];
if (!email) {
  console.error('Uso: npm run set-super-admin -- correo@empresa.com');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, {
  role: 'super_admin',
  tenantId: null,
  subscriptionActive: true,
});
await getAuth().revokeRefreshTokens(user.uid);
console.log(`Super administrador asignado a ${user.uid}. Debe volver a iniciar sesión.`);
