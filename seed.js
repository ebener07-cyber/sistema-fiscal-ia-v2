const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('Duecas2026$', 10);
  await prisma.usuario.create({
    data: {
      email: 'admin@hernandez.mx',
      nombre: 'Administrador',
      password: hashedPassword,
      rol: 'admin',
    },
  });
  console.log('Usuario admin creado exitosamente');
}

main().catch(console.error).finally(() => prisma.$disconnect());
