# Club Pickleball — proyecto listo para desplegar

Este es un proyecto Vite + React + Tailwind con la app ya integrada en `src/App.jsx`.

## Opción rápida (probar en el celular en ~2 minutos, sin instalar nada)

1. Ve a https://stackblitz.com y crea un proyecto nuevo tipo "Vite + React".
2. Sube o pega los archivos de esta carpeta (o arrastra el .zip completo).
3. StackBlitz te da una URL de vista previa en vivo — ábrela en el navegador de tu celular.
4. Dentro de StackBlitz hay un botón "Deploy" que la publica directo en Vercel con una URL permanente.

## Opción con instalación local

Necesitas tener Node.js instalado (https://nodejs.org).

```bash
npm install
npm run dev       # abre una URL local para probar en tu computadora
```

Para verla en el celular mientras pruebas localmente (misma red WiFi):
```bash
npm run dev -- --host
```
Te dará una URL tipo `http://192.168.x.x:5173` — ábrela en el navegador del celular (debe estar en la misma red WiFi).

## Publicar con una URL pública real

**Vercel (recomendado, gratis):**
1. Sube esta carpeta a un repositorio en GitHub.
2. Entra a https://vercel.com, conecta tu cuenta de GitHub, importa el repositorio.
3. Vercel detecta Vite automáticamente y te da una URL como `tuclub.vercel.app`.

**Netlify (alternativa, gratis):**
1. Corre `npm run build` (genera la carpeta `dist/`).
2. Ve a https://app.netlify.com/drop y arrastra la carpeta `dist/` — te da una URL al instante.

## Nota importante

Esta app guarda todos sus datos (reservas, usuarios, eventos, etc.) en memoria del navegador — no hay base de datos real. Cada persona que entre a la URL verá su propia sesión vacía, y todo se borra al recargar la página. Para que el club realmente comparta los mismos datos entre todos los usuarios, se necesitaría conectar un backend real (base de datos + autenticación).
