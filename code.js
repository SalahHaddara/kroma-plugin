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

async function updateDesignTokens(tokens) {
  if (!tokens) {
    throw new Error("No tokens provided");
  }

  try {
    const designSystemFrame = figma.currentPage.findOne(
      (node) => node.type === "FRAME" && node.name === "Design System",
    );

    if (!designSystemFrame) {
      throw new Error(
        "Design system frame not found. Please create the design system first.",
      );
    }

    console.log("Found Design System frame:", designSystemFrame.id);

    const fontFamily =
      tokens.typography && tokens.typography.fontFamily
        ? tokens.typography.fontFamily
        : "Inter";
    console.log("Loading fonts for:", fontFamily);
    const fontInfo = await loadFonts(fontFamily);

    const sections = [
      {
        name: "Color Palette",
        handler: async (section) => {
          if (tokens.colors) {
            console.log("Updating color palette with:", tokens.colors);
            await updateColorPalette(section, tokens.colors);
          }
        },
      },
      {
        name: "Typography System",
        handler: async (section) => {
          if (tokens.typography) {
            console.log("Updating typography with:", tokens.typography);
            await updateTypography(section, tokens.typography, fontInfo);
          }
        },
      },
      {
        name: "Buttons",
        handler: async (section) => {
          if (tokens.buttons) {
            console.log("Updating buttons with:", tokens.buttons);
            await updateButtons(section, tokens.buttons, fontInfo);
          }
        },
      },
      {
        name: "Spacing System",
        handler: async (section) => {
          if (tokens.spacing) {
            console.log("Updating spacing with:", tokens.spacing);
            await updateSpacingSection(section, tokens.spacing);
          }
        },
      },
      {
        name: "Icons",
        handler: async (section) => {
          if (tokens.icons) {
            console.log("Updating icons with:", tokens.icons);
            await updateIconsSection(section, tokens.icons);
          }
        },
      },
      {
        name: "Quotes",
        handler: async (section) => {
          if (tokens.quote) {
            console.log("Updating quote with:", tokens.quote);
            await updateQuoteSection(section, tokens.quote);
          }
        },
      },
      {
        name: "Alerts and Notifications",
        handler: async (section) => {
          if (tokens.alerts) {
            console.log("Updating alerts with:", tokens.alerts);
            await updateAlerts(section, tokens.alerts);
          }
        },
      },
      {
        name: "Inspiration Images",
        handler: async (section) => {
          if (tokens.inspirationImages) {
            console.log(
              "Updating inspiration images with:",
              tokens.inspirationImages,
            );
            await updateInspirationSection(section, tokens.inspirationImages);
          }
        },
      },
    ];

    for (const { name, handler } of sections) {
      console.log(`Looking for section: ${name}`);
      const section = designSystemFrame.findOne((node) => node.name === name);

      if (section) {
        console.log(`Found section ${name}, updating...`);
        await handler(section);
        // Force a repaint of the section
        section.resize(section.width, section.height);
      } else {
        console.warn(`Section ${name} not found`);
      }
    }

    // Force a repaint of the entire frame
    designSystemFrame.resize(designSystemFrame.width, designSystemFrame.height);

    // Ensure changes are visible
    figma.viewport.scrollAndZoomIntoView([designSystemFrame]);

    await new Promise((resolve) => setTimeout(resolve, 500));
    await exportFrameToPNG(designSystemFrame);
  } catch (error) {
    console.error("Error in updateDesignTokens:", error);
    throw error;
  }
}

async function updateTypography(section, typography, fontInfo) {
  try {
    if (!section || !typography) {
      console.warn("Missing required parameters in updateTypography");
      return;
    }

    if (!typography.sizes || typeof typography.sizes !== "object") {
      console.error("Invalid or missing typography sizes");
      return;
    }

    const validatedSizes = {
      h1: parseInt(typography.sizes.h1) || 60,
      h2: parseInt(typography.sizes.h2) || 48,
      h3: parseInt(typography.sizes.h3) || 40,
      paragraph: parseInt(typography.sizes.paragraph) || 20,
      caption: parseInt(typography.sizes.caption) || 16,
    };

    const fontsToLoad = new Set();

    // Add the regular, medium, and bold variants of the font family
    if (typography.fontFamily) {
      fontsToLoad.add({
        family: typography.fontFamily,
        style: fontInfo.styles.regular,
      });
      fontsToLoad.add({
        family: typography.fontFamily,
        style: fontInfo.styles.medium,
      });
      fontsToLoad.add({
        family: typography.fontFamily,
        style: fontInfo.styles.bold,
      });
    }

    // Load all fonts first
    await Promise.all(
      Array.from(fontsToLoad).map((font) => figma.loadFontAsync(font)),
    );

    // Get all text nodes
    const textNodes = section.findAll((node) => node.type === "TEXT");

    // Update each text node
    for (const node of textNodes) {
      if (typography.fontFamily) {
        // Determine the appropriate style based on current font weight
        let style = fontInfo.styles.regular;
        const currentStyle = node.fontName.style.toLowerCase();

        if (currentStyle.includes("bold") || currentStyle.includes("700")) {
          style = fontInfo.styles.bold;
        } else if (
          currentStyle.includes("medium") ||
          currentStyle.includes("500")
        ) {
          style = fontInfo.styles.medium;
        }

        // Set the font family and style
        node.fontName = {
          family: typography.fontFamily,
          style: style,
        };
      }

      // Update font sizes if provided
      let newSize = null;

      // Determine the appropriate size based on node name or content
      if (
        node.name.includes("H1") ||
        node.characters.startsWith("This is H1")
      ) {
        newSize = validatedSizes.h1;
      } else if (
        node.name.includes("H2") ||
        node.characters.startsWith("This is H2")
      ) {
        newSize = validatedSizes.h2;
      } else if (
        node.name.includes("H3") ||
        node.characters.startsWith("This is H3")
      ) {
        newSize = validatedSizes.h3;
      } else if (
        node.name.includes("Paragraph") ||
        node.characters.startsWith("This is Paragraph")
      ) {
        newSize = validatedSizes.paragraph;
      } else if (
        node.name.includes("Caption") ||
        node.characters.startsWith("THIS IS CAPTION")
      ) {
        newSize = validatedSizes.caption;
      }

      // Apply new size if determined
      if (typeof newSize === "number" && newSize > 0) {
        node.fontSize = newSize;

        // Update the size in details text if this is a heading
        const parentFrame = node.parent;
        if (parentFrame && parentFrame.type === "FRAME") {
          const detailsText = parentFrame.findOne(
            (n) => n.type === "TEXT" && n.characters.includes("Typeface"),
          );

          if (detailsText) {
            // Ensure font is loaded before updating details text
            await figma.loadFontAsync(detailsText.fontName);
            detailsText.characters = `${typography.fontFamily} Typeface\nSize: ${newSize}px`;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error in updateTypography:", error);
    throw error;
  }
}
