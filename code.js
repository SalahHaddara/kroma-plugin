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

const fontWeightMap = {
  100: ["Thin", "Hairline", "ExtraLight", "Ultra Light"],
  200: ["ExtraLight", "Ultra Light", "Thin"],
  300: ["Light"],
  400: ["Regular", "Normal"],
  500: ["Medium"],
  600: ["SemiBold", "Semi Bold", "Demi Bold", "DemiBold"],
  700: ["Bold"],
  800: ["ExtraBold", "Extra Bold", "Ultra Bold"],
  900: ["Black", "Heavy"],
};

async function getAvailableFontStyles(fontFamily) {
  try {
    const fonts = await figma.listAvailableFontsAsync();
    const familyFonts = fonts.filter(
      (font) => font.fontName.family === fontFamily,
    );
    return familyFonts.map((font) => font.fontName.style);
  } catch (error) {
    console.error(`Error getting fonts for ${fontFamily}:`, error);
    return [];
  }
}

function findBestStyleMatch(targetWeight, availableStyles) {
  const primaryOptions = fontWeightMap[targetWeight] || [];
  for (const option of primaryOptions) {
    if (availableStyles.includes(option)) {
      return option;
    }
  }

  const allWeights = Object.keys(fontWeightMap).map(Number);
  const closestWeight = allWeights.reduce((prev, curr) => {
    return Math.abs(curr - targetWeight) < Math.abs(prev - targetWeight)
      ? curr
      : prev;
  });

  const backupOptions = fontWeightMap[closestWeight] || [];
  for (const option of backupOptions) {
    if (availableStyles.includes(option)) {
      return option;
    }
  }

  return availableStyles.includes("Regular") ? "Regular" : availableStyles[0];
}

async function loadFonts(fontFamily) {
  try {
    const availableStyles = await getAvailableFontStyles(fontFamily);

    if (availableStyles.length === 0) {
      throw new Error(`No styles found for font ${fontFamily}`);
    }

    const requiredWeights = [400, 500, 700];

    for (const weight of requiredWeights) {
      const style = findBestStyleMatch(weight, availableStyles);
      await figma.loadFontAsync({ family: fontFamily, style: style });
      console.log(`Loaded ${fontFamily} ${style}`);
    }

    return {
      family: fontFamily,
      styles: {
        regular: findBestStyleMatch(400, availableStyles),
        medium: findBestStyleMatch(500, availableStyles),
        bold: findBestStyleMatch(700, availableStyles),
      },
    };
  } catch (error) {
    console.error(`Error loading font ${fontFamily}:`, error);
    throw error;
  }
}

async function updateColorPalette(section, colors) {
  if (!section || !colors || !Array.isArray(colors)) {
    console.error("Invalid section or colors array");
    return;
  }

  try {
    const colorRows = section.findAll(
      (node) => node.type === "FRAME" && node.layoutMode === "HORIZONTAL",
    );

    if (!colorRows || colorRows.length === 0) {
      console.error("No color rows found in section");
      return;
    }

    colors.forEach((palette, index) => {
      if (!Array.isArray(palette)) {
        console.error(`Invalid palette format at index ${index}`);
        return;
      }

      if (index >= colorRows.length) {
        console.warn(`No row found for palette ${index}`);
        return;
      }

      const row = colorRows[index];

      const swatches = row.findAll((node) => node.type === "RECTANGLE");

      if (!swatches || swatches.length === 0) {
        console.error(`No swatches found in row ${index}`);
        return;
      }

      // Update each swatch with its new color
      palette.forEach((color, swatchIndex) => {
        if (swatchIndex >= swatches.length) {
          console.warn(
            `No swatch found for color ${swatchIndex} in palette ${index}`,
          );
          return;
        }

        try {
          // Ensure the color is in the correct format
          if (typeof color !== "string" || !color.startsWith("#")) {
            console.error(`Invalid color format: ${color}`);
            return;
          }

          // Convert and apply the color
          const rgbColor = hexToRgb(color);
          swatches[swatchIndex].fills = [
            {
              type: "SOLID",
              color: rgbColor,
            },
          ];

          console.log(
            `Updated swatch ${swatchIndex} in palette ${index} with color ${color}`,
          );
        } catch (error) {
          console.error(
            `Error updating swatch ${swatchIndex} in palette ${index}:`,
            error,
          );
        }
      });
    });
  } catch (error) {
    console.error("Error in updateColorPalette:", error);
  }
}
