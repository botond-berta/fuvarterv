/* Fuvarterv — the role context: AuthGate fills it, App reads it.

   Its own tiny module because App must not import from AuthGate (the seam
   between them is event-based), but both are entitled to a shared context.

   The default is admin on purpose. It only ever applies with NO provider above
   it: in tests, and in a dev environment running on a window.storage shim, where
   there is no sign-in and nothing to restrict. On the real path AuthGate always
   supplies a provider, and there the server decides: an account with no
   user_roles row is admitted as a driver. */

import { createContext } from "react";

export const RoleContext = createContext({ role: "admin", email: null });
