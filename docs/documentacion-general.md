# **LEAT (Leak & Exposure Assessment Tool)**

Especificación técnica de arquitectura, ciclo de vida y gobernanza de secretos para entornos DevSecOps.

# **1\. Resumen Ejecutivo y Propósito**

**LEAT** es una plataforma web DevSecOps de Análisis Estático de Código (SAST) orientada a la detección dinámica de secretos (API keys, tokens, credenciales) en código fuente. Su función primordial es prevenir la fuga de información antes del commit y habilitar la detección temprana en repositorios remotos mediante alertamiento en tiempo real y gobernanza técnica.

* **Categoría:** SAST / DevSecOps Security Tooling  
* **Objetivo principal:** Detección de credenciales y prevención de fugas de datos  
* **Mecanismos clave:** Escaneo en memoria, análisis de entropía y alertas síncronas

# **2\. Planteamiento del Problema**

El almacenamiento accidental de secretos en texto plano dentro del código fuente representa un vector de ataque recurrente:

* **Exposición inadvertida:** Inclusión de llaves de bases de datos, APIs de pago y credenciales de infraestructura cloud.  
* **Superficie de ataque:** Repositorios tanto públicos como privados en plataformas de control de versiones (GitHub) que permiten el movimiento lateral o acceso indebido a la infraestructura.

# **3\. Matriz de Casos de Uso e Ingesta de Código**

| Modalidad | Origen | Volumen | Proceso de Ingesta y Alcance |
| :---- | :---- | :---- | :---- |
| **Local / Fragmento** | Directo / Clipboard | Bajo | Carga de archivos puntuales (`.env`, `.json`) o snippets de texto plano pegados en la UI. |
| **Remoto / GitHub** | Repositorio Cloud | Alto | Parseo de URL mediante API REST (`@octokit/rest`), descarga del árbol de archivos en memoria y exclusión de dependencias. |
| **Local / Paquete** | Comprimido (`.zip`) | Alto | Descompresión en cliente vía `JSZip`, filtrado de artefactos no procesables (`node_modules`, binarios) y despacho seguro a API. |

# **4\. Arquitectura del Motor de Análisis (Core)**

El backend opera sobre Node.js implementando un pipeline híbrido de detección y ofuscación:

## **4.1. Estrategia de Detección**

* **Expresiones Regulares (Regex):** Coincidencia de patrones estructurales conocidos (AWS Access Keys, Stripe API Keys, GitHub Personal Access Tokens).  
* **Entropía de Shannon:** Cálculo matemático del nivel de incertidumbre en las cadenas de texto para capturar secretos pseudoaleatorios sin firma estandarizada.

## **4.2. Privacidad y Mitigación de Riesgos**

LEAT no almacena secretos en texto plano bajo ninguna circunstancia:

* **Enmascaramiento (Data Masking):** Presentación censurada para almacenamiento y visualización (ejemplo: `sk_live_123...890`).  
* **Función Criptográfica Hash:** Generación de resúmenes SHA-256 unidireccionales para indexar duplicados y deduplicar hallazgos sin retener el secreto original.

# **5\. Notificaciones y Alertas**

El subsistema de notificación se integra mediante webhooks para minimizar el tiempo medio de respuesta:

* **Canal:** Discord Webhooks (HTTP POST).  
* **Condición de Disparo:** Detección de vulnerabilidades con severidad clasificada como **Alta** o **Crítica**.  
* **Payload:** Objetos estructurados tipo `Embed` con codificación cromática contextual según el nivel de severidad.

# **6\. Flujo del Ciclo de Vida (UX / DX)**

```
[1. Auth: Supabase] 
       │
       ▼
[2. Dashboard: Métricas & Score] 
       │
       ▼
[3. Ingesta: Snippet / Archivo / Repo / ZIP] 
       │
       ▼
[4. Inspección: Monaco Editor / Prism.js] 
       │
       ▼
[5. Remediación: Gestión de Estado]
```

## **Estados de Vulnerabilidad Disponibles**

* **Activa:** Vulnerabilidad confirmada sin mitigar.  
* **Resuelta:** Credencial revocada o eliminada del árbol de archivos.  
* **Ignorada:** Excepción técnica aprobada.  
* **Falso Positivo:** Coincidencia descartada tras validación contextual.

# **7\. Especificación del Stack Tecnológico**

| Capa | Tecnologías | Propósito |
| :---- | :---- | :---- |
| **Frontend** | Next.js, React, TypeScript, Tailwind CSS | Estructura de la aplicación e interfaz de usuario |
| **UI Components** | Monaco Editor, Lucide React, Tremor, Recharts | Visualización de código, métricas y telemetría |
| **Backend** | Node.js (Next.js API Routes / Server Actions) | Orquestación, análisis SAST y diseño RESTful |
| **Base de Datos** | PostgreSQL (Supabase) | Persistencia relacional, autenticación y auditoría |
| **Integraciones** | GitHub REST API, Discord Webhooks | Ingesta remota y despacho síncrono de alertas |

# **8\. Identidad Visual y UI**

La plataforma utiliza una interfaz con modo oscuro inspirada en soluciones de ciberseguridad modernas, fundamentada en la simbología cromática de su acrónimo:

* **Cyan:** Representa la **L** (*Leak* / Fuga de Datos).  
* **Púrpura:** Representa la combinación **EA** (*Assessment* / Motor de Análisis central).  
* **Coral / Rojo:** Representa la **T** (*Threat* / Grado de Amenaza detectado).

# **9\. Taxonomía de Registros (Audit Logs)**

El sistema estructura la auditoría en tres dominios clave:

* **Scan Logs:** Metadatos de ejecución del escaneo, tiempos de análisis, conteo de ficheros procesados y parámetros de ingesta.  
* **Vulnerability Lifecycle Logs:** Trazabilidad integral de las vulnerabilidades, cálculo de *Time-to-remediate* (TTR) y bitácora de transiciones de estado.  
* **Alert Logs:** Registro transaccional de entregas HTTP a los webhooks de Discord, validaciones de código de respuesta y reintentos.

