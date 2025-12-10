# Snake3D Refactored

Modern implementation of the classic Snake 3D game using TypeScript, Three.js, and Vite.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

## Getting Started

1.  **Navigate to the project directory:**
    ```bash
    cd snake3d
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

## Build for Production

To create an optimized production build:

```bash
npm run build
```

The output will be in the `dist` directory. You can preview the production build locally using:

```bash
npm run preview
```

## Project Structure

- `src/main.ts`: Application entry point and Three.js scene setup.
- `src/style.css`: Global styles.
- `public/`: Static assets (textures, fonts).
- `index.html`: Main HTML template.
