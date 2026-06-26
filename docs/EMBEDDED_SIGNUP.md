# Embedded Signup — guía de configuración

Tu app **ya tiene el código** para Embedded Signup. Solo falta configurar Meta y agregar una variable de entorno.

## 1. Meta — crear la configuración de Embedded Signup

1. Entrá a [developers.facebook.com](https://developers.facebook.com) → tu app.
2. Menú **WhatsApp** → **Embedded Signup** (o **Conviértete en socio** → **Administrador de registro insertado**).
3. Clic en **Crear configuración** / **Create configuration**.
4. Completá el asistente:
   - **Permisos:** `whatsapp_business_management`, `whatsapp_business_messaging`
   - **Tipo de sesión:** flujo para que el negocio conecte su WABA y número
5. Al finalizar, copiá el **Configuration ID** (número largo, ej. `2847293847293847`).

## 2. Meta — dominios y redirects (obligatorio)

Reemplazá `TU-DOMINIO` por tu URL pública (ej. `messages-crm.onrender.com`).

### Configuración básica de la app → Básica

| Campo | Valor |
|-------|--------|
| **Dominios de la app** | `TU-DOMINIO` |

### Facebook Login for Business → Valid OAuth Redirect URIs

```
https://TU-DOMINIO/connect
https://TU-DOMINIO/auth/callback
```

### Allowed Domains for the JavaScript SDK

```
TU-DOMINIO
localhost
```

(`localhost` solo si seguís probando en local.)

### Embedded Signup (en la config que creaste)

- **Redirect URI:** `https://TU-DOMINIO/connect`

## 3. Render — variable de entorno

En tu **Web Service** → **Environment** → agregá:

```env
WHATSAPP_CONFIGURATION_ID=el_configuration_id_de_meta
```

Guardá. Render redeploya automáticamente.

Variables que ya deberías tener:

```env
APP_ID=...
APP_SECRET=...
BASE_URL=https://TU-DOMINIO
OAUTH_REDIRECT_URI=https://TU-DOMINIO/auth/callback
VERIFY_TOKEN=...
REDIS_HOST=...
REDIS_PORT=...
WHATSAPP_REGISTER_PIN=123456
```

## 4. Cómo saber que funciona

1. Abrí `https://TU-DOMINIO/connect`
2. **No** debe aparecer el aviso *"Sin WHATSAPP_CONFIGURATION_ID..."*
3. Debe decir que **Embedded Signup está activo**
4. Clic en **Conectar WhatsApp con Meta** → se abre un **popup** de Meta
5. Completás el wizard (cuenta, WABA, número)
6. Terminás en `/chat?connected=1`

## 5. Problemas frecuentes

| Problema | Solución |
|----------|----------|
| Popup bloqueado | Permitir popups para tu dominio |
| "Dominio no incluido" | Agregar dominio en **App Domains** y **Allowed Domains** |
| Sigue OAuth en pestaña | Falta `WHATSAPP_CONFIGURATION_ID` en Render o redeploy pendiente |
| Error al intercambiar token | Verificar `APP_SECRET` y redirect URIs en Meta |

## 6. Ejemplo producción (Render)

```env
BASE_URL=https://messages-crm.onrender.com
OAUTH_REDIRECT_URI=https://messages-crm.onrender.com/auth/callback
WHATSAPP_CONFIGURATION_ID=1234567890123456
```

Meta App Domains: `messages-crm.onrender.com`
