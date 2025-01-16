figma.showUI(__html__, { width: 300, height: 300 });

figma.ui.onmessage = async (msg) => {
  console.log("Message received:", msg.type);

  try {
    if (msg.type === "generate-design-system") {
      // Step 1: Create the design system template
      const frame = await createDesignSystem();
      if (!frame) {
        throw new Error("Failed to create design system template");
      }

      // Notify UI that template is created and ready for next step
      figma.ui.postMessage({ type: "step-1-complete" });

      // Ensure the frame is visible
      figma.viewport.scrollAndZoomIntoView([frame]);
    } else if (msg.type === "apply-design-tokens") {
      if (!msg.tokens) {
        throw new Error("No tokens provided for update");
      }

      console.log("Applying design tokens:", msg.tokens);
      await updateDesignTokens(msg.tokens);

      // Find the frame again to ensure it's updated
      const frame = figma.currentPage.findOne(
        (node) => node.type === "FRAME" && node.name === "Design System",
      );

      if (frame) {
        // Force a repaint
        frame.resize(frame.width, frame.height);
        figma.viewport.scrollAndZoomIntoView([frame]);
      }

      // Notify UI that the entire process is complete
      figma.ui.postMessage({ type: "generation-complete" });
    }
  } catch (error) {
    console.error("Operation error:", error);
    figma.ui.postMessage({
      type: "generation-error",
      message: error.message,
    });
  }
};

function validateAndConvertColor(color) {
  console.log("Converting color:", color);

  // If it's already an RGB object
  if (
    typeof color === "object" &&
    color !== null &&
    typeof color.r === "number" &&
    typeof color.g === "number" &&
    typeof color.b === "number"
  ) {
    return color;
  }

  // If it's a string, handle different formats
  if (typeof color === "string") {
    // Handle hex format
    if (color.startsWith("#")) {
      const r = parseInt(color.slice(1, 3), 16) / 255;
      const g = parseInt(color.slice(3, 5), 16) / 255;
      const b = parseInt(color.slice(5, 7), 16) / 255;

      if (isNaN(r) || isNaN(g) || isNaN(b)) {
        throw new Error(`Invalid hex color format: ${color}`);
      }

      return { r, g, b };
    }

    // Handle rgba format
    if (color.startsWith("rgba")) {
      const values = color.match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)/,
      );
      if (values) {
        const r = parseInt(values[1]) / 255;
        const g = parseInt(values[2]) / 255;
        const b = parseInt(values[3]) / 255;

        if (isNaN(r) || isNaN(g) || isNaN(b)) {
          throw new Error(`Invalid rgba color format: ${color}`);
        }

        return { r, g, b };
      }
    }

    // Handle rgb format
    if (color.startsWith("rgb")) {
      const values = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (values) {
        const r = parseInt(values[1]) / 255;
        const g = parseInt(values[2]) / 255;
        const b = parseInt(values[3]) / 255;

        if (isNaN(r) || isNaN(g) || isNaN(b)) {
          throw new Error(`Invalid rgb color format: ${color}`);
        }

        return { r, g, b };
      }
    }

    // Handle color keywords
    const colorKeywords = {
      black: { r: 0, g: 0, b: 0 },
      white: { r: 1, g: 1, b: 1 },
      red: { r: 1, g: 0, b: 0 },
      green: { r: 0, g: 1, b: 0 },
      blue: { r: 0, g: 0, b: 1 },
      transparent: { r: 0, g: 0, b: 0, a: 0 },
    };

    if (colorKeywords[color.toLowerCase()]) {
      return colorKeywords[color.toLowerCase()];
    }
  }

  // Default to black if color is invalid
  console.warn(`Invalid color value: ${color}, defaulting to black`);
  return { r: 0, g: 0, b: 0 };
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  hex = hex.replace("#", "");

  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }

  if (hex.length !== 6) {
    throw new Error(`Invalid hex length: ${hex}`);
  }

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    throw new Error(`Invalid hex values: ${hex}`);
  }

  return { r, g, b };
}
