import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro y NO cree una organización
 * nueva (la membresía la pone explícitamente quien invita). No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __raeInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__raeInternalSignup) {
    globalForSignup.__raeInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__raeInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

export function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}
