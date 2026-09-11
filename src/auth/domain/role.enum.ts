// Fuente unica de verdad: los enums viven en prisma/schema.prisma y se reexportan aqui.
// Redeclararlos a mano garantizaria que algun dia se desincronicen de la base.
export { Role, UserStatus } from '../../generated/prisma/enums.js';
