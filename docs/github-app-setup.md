# Conectar la GitHub App de Patchwork

La integración usa una **GitHub App** (no una OAuth App independiente) para instalarse sobre repositorios, sincronizarlos y recibir eventos firmados.

## Valores de GitHub

En GitHub, abre **Settings → Developer settings → GitHub Apps → tu app → General**.

- **Homepage URL:** URL pública de Patchwork. En desarrollo puede ser `http://127.0.0.1:5173/`.
- **Callback URL:** `https://lwpgulisvtiuyivsymxz.supabase.co/functions/v1/github-gateway`
- **Setup URL:** la misma URL de la función anterior.
- Deja desactivada la autorización OAuth durante la instalación. Patchwork inicia la autorización después del setup.
- Genera una **Client secret** desde los ajustes de la app y guárdala en Supabase. GitHub exige generar una **Private key** para poder instalar la App; el flujo actual de Patchwork no la usa en tiempo de ejecución. Conserva el archivo `.pem` fuera del repositorio y no lo pongas en el frontend ni lo compartas por chat.

En **Permissions & events**, concede solo acceso de lectura:

- Repository permissions: **Metadata**, **Contents**, **Pull requests** e **Issues**: `Read-only`.
- Suscribe los eventos **Push**, **Pull request** e **Issues**.
- GitHub envía automáticamente los eventos `installation` e `installation_repositories` a las GitHub Apps; no aparecen como suscripciones seleccionables.

En **Webhook**, actívalo, usa `https://lwpgulisvtiuyivsymxz.supabase.co/functions/v1/github-gateway` como URL y genera un secreto aleatorio fuerte.

## Secretos de Supabase

Guarda los valores en **Supabase Dashboard → Edge Functions → Secrets**. No añadas secretos de GitHub a `.env`, al cliente React ni a variables `VITE_*`.

| Secreto | Valor |
| --- | --- |
| `GITHUB_APP_SLUG` | Slug que aparece en la URL de la GitHub App: `github.com/apps/<slug>` |
| `GITHUB_APP_ID` | App ID de la página General |
| `GITHUB_APP_CLIENT_ID` | Client ID de la GitHub App |
| `GITHUB_APP_CLIENT_SECRET` | Client secret recién generado |
| `GITHUB_WEBHOOK_SECRET` | El mismo secreto configurado en Webhook |
| `PATCHWORK_ALLOWED_ORIGINS` | Origen(es) exacto(s) de Patchwork separados por comas, sin rutas; para local: `http://127.0.0.1:5173,http://localhost:5173` |

La sincronización inicial usa un token de usuario temporal y los webhooks aportan los eventos siguientes. El token temporal no se guarda. Aunque GitHub pide generar una clave privada antes de instalar la App, el código actual no la necesita en Supabase.

## Activación

1. Aplica las migraciones de `supabase/migrations/`.
2. Configura los secretos de arriba.
3. Despliega las funciones:

   ```powershell
   npx supabase functions deploy github-connect-start github-gateway --project-ref <project-ref> --use-api
   ```

4. Inicia sesión en Patchwork, elige un espacio del que seas propietario y pulsa **Conectar GitHub**.
5. Instala la GitHub App en tu cuenta y selecciona únicamente los repositorios que quieras compartir con ese espacio.

El primer flujo sincroniza los repositorios seleccionados. A partir de entonces, los webhooks guardan commits, pull requests e issues en la actividad del espacio. La cuenta que inicia la conexión debe ser el propietario del espacio.

Para el despliegue público, cambia **Homepage URL**, la URL permitida de Supabase Auth y `PATCHWORK_ALLOWED_ORIGINS` al dominio real de Patchwork. Los callback y webhook permanecen en la URL de Supabase mientras se use esta Edge Function.
