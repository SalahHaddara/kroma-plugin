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

async function updateButtons(section, buttonStyles, fontInfo) {
  const buttonFrames = section.findAll(
    (node) => node.type === "FRAME" && node.name.startsWith("Button "),
  );

  for (const frame of buttonFrames) {
    try {
      // Extract button number from frame name
      const buttonNumber = parseInt(frame.name.replace("Button ", ""));
      const styleKey = `button${buttonNumber}`;
      const style = buttonStyles[styleKey];

      if (!style) {
        console.warn(`No style found for ${frame.name}`);
        continue;
      }

      const button = frame.findOne(
        (node) =>
          node.type === "FRAME" && node.name === `Button ${buttonNumber}`,
      );

      if (!button) {
        console.warn(`Button not found in ${frame.name}`);
        continue;
      }

      // Update button styles
      button.fills = [
        {
          type: "SOLID",
          color: validateAndConvertColor(style.background),
        },
      ];

      // Update border if specified
      if (style.border) {
        button.strokes = [
          {
            type: "SOLID",
            color: validateAndConvertColor(style.border),
          },
        ];
        button.strokeWeight = 1.5;
      } else {
        button.strokes = [];
      }

      // Update border radius
      button.cornerRadius = parseInt(style.borderRadius);

      // Update padding
      button.paddingLeft = parseInt(style.paddingX);
      button.paddingRight = parseInt(style.paddingX);
      button.paddingTop = parseInt(style.paddingY);
      button.paddingBottom = parseInt(style.paddingY);

      // Update text node
      const textNode = button.findOne((node) => node.type === "TEXT");
      if (textNode) {
        // Update text color
        textNode.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(style.text),
          },
        ];

        // Update font size
        textNode.fontSize = parseInt(style.fontSize);

        let letterSpacingValue = 0;
        if (style.letterSpacing !== "normal") {
          letterSpacingValue =
            parseFloat(style.letterSpacing.replace("px", "")) || 0;
        }
        textNode.letterSpacing = {
          value: letterSpacingValue,
          unit: "PIXELS",
        };

        const fontFamily = fontInfo ? fontInfo.family : "Inter";
        const weightStyle = findBestStyleMatch(parseInt(style.fontWeight), [
          "Regular",
          "Medium",
          "Semi Bold",
          "Bold",
        ]);

        // Ensure font is loaded before setting it
        try {
          await figma.loadFontAsync({
            family: fontFamily,
            style: weightStyle,
          });

          textNode.fontName = {
            family: fontFamily,
            style: weightStyle,
          };
        } catch (fontError) {
          console.warn(
            `Failed to load font ${fontFamily} ${weightStyle}, falling back to Inter:`,
            fontError,
          );
          // Fallback to Inter if the specified font fails to load
          await figma.loadFontAsync({
            family: "Inter",
            style: weightStyle,
          });
          textNode.fontName = {
            family: "Inter",
            style: weightStyle,
          };
        }

        // Update text transform
        let text = `Button ${buttonNumber}`;
        if (style.textTransform === "uppercase") {
          text = text.toUpperCase();
        } else if (style.textTransform === "capitalize") {
          text = text
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        }
        textNode.characters = text;
      }

      // Resize the button frame to accommodate the new styles
      const newHeight =
        parseInt(style.paddingY) * 2 + parseInt(style.fontSize) + 8;
      button.resize(button.width, newHeight);
      frame.resize(frame.width, newHeight);
    } catch (error) {
      console.error(`Error updating ${frame.name}:`, error);
    }
  }
}

async function createDesignSystem() {
  try {
    // Load fonts first
    await Promise.all([
      figma.loadFontAsync({ family: "Inter", style: "Regular" }),
      figma.loadFontAsync({ family: "Inter", style: "Medium" }),
      figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }),
    ]).catch((error) => {
      console.error("Error loading fonts:", error);
      throw new Error("Failed to load required fonts");
    });

    // Create main frame
    const frame = figma.createFrame();
    frame.x = 0;
    frame.y = 0;
    frame.name = "Design System";
    frame.resize(2200, 1030); // Wider frame to accommodate larger sections
    frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    // Create sections with error handling
    const defaultSectionWidth = 400;

    // Create sections asynchronously
    const sections = [
      {
        name: "Color Palette",
        creator: createColorPaletteSection,
        x: 40,
        y: 40,
        width: defaultSectionWidth,
      },
      {
        name: "Buttons",
        creator: createButtonsSection,
        x: 520,
        y: 40,
        width: 200,
      },
      {
        name: "Typography System",
        creator: createTypographySection,
        x: 40,
        y: 400,
        width: 470,
      },
      {
        name: "Spacing System",
        creator: createSpacingSection,
        x: 520,
        y: 600,
        width: 220,
      },
      {
        name: "Icons",
        creator: createIconsSection,
        x: 800,
        y: 40,
        width: defaultSectionWidth,
      },
      {
        name: "Quotes",
        creator: createQuoteSection,
        x: 800,
        y: 300,
        width: defaultSectionWidth,
      },
      {
        name: "Alerts",
        creator: createAlertsSection,
        x: 800,
        y: 550,
        width: defaultSectionWidth,
      },
      {
        name: "Inspiration Images",
        creator: createInspirationSection,
        x: 1300,
        y: 40,
        width: 800, // Set specific width for inspiration section
      },
    ];

    // Create and position each section
    for (const section of sections) {
      try {
        console.log(`Creating section: ${section.name}`);
        const sectionNode = await section.creator();

        if (sectionNode) {
          // Only resize width if the section isn't 'Inspiration Images'
          sectionNode.resize(section.width, sectionNode.height);
          sectionNode.x = section.x;
          sectionNode.y = section.y;
          frame.appendChild(sectionNode);
          console.log(`Successfully created section: ${section.name}`);
        } else {
          console.warn(`Section creator returned null for: ${section.name}`);
        }
      } catch (error) {
        console.error(`Error creating section ${section.name}:`, error);
        // Continue with next section instead of failing completely
      }
    }

    // Select and zoom to frame
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    return frame;
  } catch (error) {
    console.error("Error in createDesignSystem:", error);
    throw error;
  }
}

function createColorPaletteSection() {
  const section = figma.createFrame();
  section.name = "Color Palette";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 24;
  section.fills = [];

  const title = figma.createText();
  title.characters = "Color Palette";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  // Color rows
  const colors = [
    // Purple palette
    [
      "#F4F1FF",
      "#D9D3FF",
      "#BFB3FF",
      "#9980FF",
      "#6666E6",
      "#4D4DB3",
      "#333380",
    ],
    // Green palette
    [
      "#CCFF4D",
      "#B3E635",
      "#99CC1A",
      "#80B300",
      "#668000",
      "#4D6600",
      "#334D00",
    ],
    // Gray palette
    [
      "#F2F2F2",
      "#D9D9D9",
      "#BFBFBF",
      "#A6A6A6",
      "#737373",
      "#404040",
      "#1A1A1A",
    ],
  ];

  colors.forEach((palette) => {
    const row = figma.createFrame();
    row.resize(350, 50);
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 0;
    row.fills = [];

    palette.forEach((color) => {
      const swatch = figma.createRectangle();
      swatch.resize(50, 50); // Fixed width for each swatch
      swatch.fills = [{ type: "SOLID", color: hexToRgb(color) }];
      row.appendChild(swatch);
    });

    section.appendChild(row);
  });

  return section;
}

function createButtonsSection() {
  const section = figma.createFrame();
  section.name = "Buttons";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 32;
  section.fills = [];

  const title = figma.createText();
  title.characters = "Buttons";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  const createButton = (config, index) => {
    const row = figma.createFrame();
    row.name = `Button ${index + 1}`;
    row.resize(
      row.height,
      parseInt(config.paddingY) * 2 + parseInt(config.fontSize) + 8,
    );
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 16;
    row.fills = [];

    // Create button
    const button = figma.createFrame();
    button.resize(
      button.width,
      parseInt(config.paddingY) * 2 + parseInt(config.fontSize) + 8,
    );
    button.name = `Button ${index + 1}`;
    button.layoutMode = "HORIZONTAL";

    // Set background
    button.fills = [
      { type: "SOLID", color: validateAndConvertColor(config.background) },
    ];

    // Set border if exists
    if (config.border) {
      button.strokes = [
        { type: "SOLID", color: validateAndConvertColor(config.border) },
      ];
      button.strokeWeight = 1.5;
    }

    // Set padding
    button.paddingLeft = parseInt(config.paddingX);
    button.paddingRight = parseInt(config.paddingX);
    button.paddingTop = parseInt(config.paddingY);
    button.paddingBottom = parseInt(config.paddingY);

    // Set border radius
    button.cornerRadius = parseInt(config.borderRadius);

    // Alignment
    button.primaryAxisAlignItems = "CENTER";
    button.counterAxisAlignItems = "CENTER";

    // Create text
    const text = figma.createText();
    text.characters = `Button ${index + 1}`;
    text.fills = [
      { type: "SOLID", color: validateAndConvertColor(config.text) },
    ];

    // Set font size
    text.fontSize = parseInt(config.fontSize);

    // Set font weight using the helper function
    const weightStyle = findBestStyleMatch(parseInt(config.fontWeight), [
      "Regular",
      "Medium",
      "Semi Bold",
      "Bold",
    ]);
    text.fontName = { family: "Inter", style: weightStyle };

    // Set letter spacing
    text.letterSpacing = {
      value: parseFloat(config.letterSpacing),
      unit: "PIXELS",
    };

    // Set text transform
    if (config.textTransform === "uppercase") {
      text.characters = text.characters.toUpperCase();
    } else if (config.textTransform === "capitalize") {
      text.characters = text.characters
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    button.appendChild(text);
    row.appendChild(button);
    return row;
  };

  // Create default buttons (will be updated later)
  for (let i = 0; i < 6; i++) {
    const defaultConfig = {
      background: "#0EA5E9",
      text: "#FFFFFF",
      borderRadius: "12px",
      paddingX: "24px",
      paddingY: "14px",
      fontSize: "16px",
      fontWeight: "600",
      letterSpacing: "0.5px",
      textTransform: "none",
    };
    const button = createButton(defaultConfig, i);
    section.appendChild(button);
  }

  return section;
}

function createTypographySection() {
  const section = figma.createFrame();
  section.name = "Typography System";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 32;
  section.fills = [];

  const title = figma.createText();
  title.characters = "Typography System";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  const styles = [
    { text: "This is H1", size: 60, style: "Semi Bold" },
    { text: "This is H2", size: 48, style: "Semi Bold" },
    { text: "This is H3", size: 40, style: "Semi Bold" },
    { text: "This is Paragraph", size: 20, style: "Regular" },
    { text: "THIS IS CAPTION", size: 16, style: "Regular" },
  ];

  styles.forEach((style) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 24;
    row.fills = [];
    row.resize(470, 90);
    row.layoutMode = "HORIZONTAL";

    const sample = figma.createText();
    sample.characters = style.text;
    sample.fontSize = style.size;
    sample.fontName = { family: "Inter", style: style.style };

    const details = figma.createText();
    details.characters = `Inter Typeface\nSize: ${style.size}px`;
    details.fontSize = 14;
    details.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];

    row.appendChild(sample);
    row.appendChild(details);
    section.appendChild(row);
  });

  return section;
}

function createSpacingSection() {
  const section = figma.createFrame();
  section.name = "Spacing System";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 24;
  section.fills = [];

  const title = figma.createText();
  title.characters = "Spacing System";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  // Define default spacing values
  const spacings = [
    { name: "Micro", size: 4 },
    { name: "XS", size: 8 },
    { name: "SM", size: 12 },
    { name: "Base", size: 16 },
    { name: "MD", size: 24 },
    { name: "LG", size: 32 },
    { name: "XL", size: 48 },
    { name: "2XL", size: 64 },
  ];

  spacings.forEach((spacing) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 12;
    row.fills = [];
    row.resize(380, 24);
    row.counterAxisAlignItems = "CENTER";

    const line = figma.createLine();
    line.strokeWeight = 2;
    line.strokeCap = "ROUND";
    line.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    line.resize(spacing.size, 0);

    const label = figma.createText();
    label.characters = `${spacing.size}px - ${spacing.name}`;
    label.fontSize = 14;
    label.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];

    row.appendChild(line);
    row.appendChild(label);
    section.appendChild(row);
  });

  return section;
}

async function updateSpacingSection(section, spacingTokens) {
  if (!section || !spacingTokens) return;

  // Get the title element
  const title = section.findOne(
    (node) => node.type === "TEXT" && node.characters === "Spacing System",
  );

  // Remove all other elements except title
  section.children.forEach((child) => {
    if (child !== title) {
      child.remove();
    }
  });

  // Create new spacing examples
  const spacings = [];
  for (const [name, size] of Object.entries(spacingTokens)) {
    spacings.push({ name: name, size: size });
  }

  spacings.sort((a, b) => a.size - b.size); // Sort by size

  spacings.forEach((spacing) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 12;
    row.fills = [];
    row.resize(380, 24);
    row.counterAxisAlignItems = "CENTER";

    const line = figma.createLine();
    line.strokeWeight = 2;
    line.strokeCap = "ROUND";
    line.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    line.resize(spacing.size, 0);

    const label = figma.createText();
    label.characters = `${spacing.size}px - ${spacing.name}`;
    label.fontSize = 14;
    label.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];

    row.appendChild(line);
    row.appendChild(label);
    section.appendChild(row);
  });
}

function createAlertsSection() {
  const section = figma.createFrame();
  section.name = "Alerts and Notifications";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 24;
  section.fills = [];

  const title = figma.createText();
  title.characters = "Alerts and Notifications";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  const createNotification = (config, index) => {
    // Create alert container
    const alertFrame = figma.createFrame();
    alertFrame.name = `Alert ${index + 1}`;
    alertFrame.layoutMode = "HORIZONTAL";
    alertFrame.itemSpacing = 12;
    alertFrame.resize(380, 80);
    alertFrame.paddingTop = parseInt(config.paddingY);
    alertFrame.paddingBottom = parseInt(config.paddingY);
    alertFrame.paddingLeft = parseInt(config.paddingX);
    alertFrame.paddingRight = parseInt(config.paddingX);
    alertFrame.cornerRadius = parseInt(config.borderRadius);
    alertFrame.fills = [
      {
        type: "SOLID",
        color: validateAndConvertColor(config.background),
      },
    ];

    // Create left border
    const border = figma.createRectangle();
    border.resize(parseInt(config.borderWidth), 48);
    border.cornerRadius = parseInt(config.borderWidth) / 2;
    border.fills = [
      {
        type: "SOLID",
        color: validateAndConvertColor(config.border),
      },
    ];

    // Create content container
    const content = figma.createFrame();
    content.name = "Content";
    content.layoutMode = "VERTICAL";
    content.itemSpacing = 4;
    content.fills = [];
    content.resize(300, 48);

    // Create alert title
    const alertTitle = figma.createText();
    alertTitle.characters = config.titleText || `Notification ${index + 1}`;
    alertTitle.fontSize = parseInt(config.titleSize);
    alertTitle.fontName = {
      family: "Inter",
      style: findBestStyleMatch(parseInt(config.titleWeight), [
        "Regular",
        "Medium",
        "Semi Bold",
        "Bold",
      ]),
    };
    alertTitle.letterSpacing = {
      value: parseFloat(config.titleLetterSpacing),
      unit: "PIXELS",
    };
    alertTitle.fills = [
      {
        type: "SOLID",
        color: validateAndConvertColor(config.title),
      },
    ];

    // Create message
    const message = figma.createText();
    message.characters = config.message || `Notification message ${index + 1}`;
    message.fontSize = parseInt(config.messageSize);
    message.fontName = {
      family: "Inter",
      style: findBestStyleMatch(parseInt(config.messageWeight), [
        "Regular",
        "Medium",
        "Semi Bold",
        "Bold",
      ]),
    };
    message.letterSpacing = {
      value: parseFloat(config.messageLetterSpacing),
      unit: "PIXELS",
    };
    message.fills = [
      {
        type: "SOLID",
        color: validateAndConvertColor(config.text),
      },
    ];

    content.appendChild(alertTitle);
    content.appendChild(message);

    alertFrame.appendChild(border);
    alertFrame.appendChild(content);

    return alertFrame;
  };

  // Create default notifications (will be updated later)
  const defaultConfig = {
    background: "#F0FDF4",
    border: "#10B981",
    title: "#047857",
    text: "#065F46",
    titleText: "Notification Title",
    message: "Notification message",
    icon: "#10B981",
    borderRadius: "8px",
    paddingX: "16px",
    paddingY: "16px",
    titleSize: "16px",
    titleWeight: "600",
    titleLetterSpacing: "0px",
    messageSize: "14px",
    messageWeight: "400",
    messageLetterSpacing: "0px",
    borderWidth: "4px",
    iconSize: "20px",
  };

  for (let i = 0; i < 4; i++) {
    const alert = createNotification(defaultConfig, i);
    section.appendChild(alert);
  }

  return section;
}

async function updateAlerts(section, alertsConfig) {
  const alertFrames = section.findAll(
    (node) => node.type === "FRAME" && node.name.startsWith("Alert "),
  );

  for (const frame of alertFrames) {
    try {
      // Extract alert number from frame name
      const alertNumber = parseInt(frame.name.replace("Alert ", ""));
      const styleKey = `alert${alertNumber}`;
      const style = alertsConfig[styleKey];

      if (!style) {
        console.warn(`No style found for ${frame.name}`);
        continue;
      }

      // Update main frame styles
      frame.fills = [
        {
          type: "SOLID",
          color: validateAndConvertColor(style.background),
        },
      ];
      frame.cornerRadius = parseInt(style.borderRadius);
      frame.paddingTop = parseInt(style.paddingY);
      frame.paddingBottom = parseInt(style.paddingY);
      frame.paddingLeft = parseInt(style.paddingX);
      frame.paddingRight = parseInt(style.paddingX);

      // Update border rectangle
      const border = frame.findOne((node) => node.type === "RECTANGLE");
      if (border) {
        border.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(style.border),
          },
        ];
        const borderWidth = parseInt(style.borderWidth);
        border.resize(borderWidth, border.height);
        border.cornerRadius = borderWidth / 2;
      }

      // Get content container
      const content = frame.findOne(
        (node) => node.type === "FRAME" && node.name === "Content",
      );

      if (content) {
        // Update title
        const titleNode = content.findChild(
          (node) =>
            node.type === "TEXT" &&
            (node.characters.includes("Notification") ||
              node.characters.includes("Success") ||
              node.characters.includes("Error") ||
              node.characters.includes("Warning") ||
              node.characters.includes("Information")),
        );

        if (titleNode) {
          // Load font for title
          const titleWeightStyle = findBestStyleMatch(
            parseInt(style.titleWeight),
            ["Regular", "Medium", "Semi Bold", "Bold"],
          );

          await figma.loadFontAsync({
            family: "Inter",
            style: titleWeightStyle,
          });

          titleNode.fontName = {
            family: "Inter",
            style: titleWeightStyle,
          };

          titleNode.fontSize = parseInt(style.titleSize);
          titleNode.fills = [
            {
              type: "SOLID",
              color: validateAndConvertColor(style.title),
            },
          ];

          // Update title text
          titleNode.characters = style.titleText;

          // Handle letter spacing
          let titleLetterSpacing = 0;
          if (style.titleLetterSpacing !== "normal") {
            titleLetterSpacing =
              parseFloat(style.titleLetterSpacing.replace("px", "")) || 0;
          }
          titleNode.letterSpacing = {
            value: titleLetterSpacing,
            unit: "PIXELS",
          };
        }

        // Update message
        const messageNode = content.findChild(
          (node) =>
            node.type === "TEXT" &&
            !node.characters.includes("Notification") &&
            !node.characters.includes("Success") &&
            !node.characters.includes("Error") &&
            !node.characters.includes("Warning") &&
            !node.characters.includes("Information"),
        );

        if (messageNode) {
          // Load font for message
          const messageWeightStyle = findBestStyleMatch(
            parseInt(style.messageWeight),
            ["Regular", "Medium", "Semi Bold", "Bold"],
          );

          await figma.loadFontAsync({
            family: "Inter",
            style: messageWeightStyle,
          });

          messageNode.fontName = {
            family: "Inter",
            style: messageWeightStyle,
          };

          messageNode.fontSize = parseInt(style.messageSize);
          messageNode.fills = [
            {
              type: "SOLID",
              color: validateAndConvertColor(style.text),
            },
          ];
          messageNode.characters = style.message;

          // Handle letter spacing
          let messageLetterSpacing = 0;
          if (style.messageLetterSpacing !== "normal") {
            messageLetterSpacing =
              parseFloat(style.messageLetterSpacing.replace("px", "")) || 0;
          }
          messageNode.letterSpacing = {
            value: messageLetterSpacing,
            unit: "PIXELS",
          };
        }
      }

      // Recalculate frame heights based on content
      if (content) {
        const totalHeight =
          parseInt(style.paddingY) * 2 +
          parseInt(style.titleSize) +
          parseInt(style.messageSize) +
          content.itemSpacing;
        frame.resize(frame.width, totalHeight);

        // Update border height
        if (border) {
          border.resize(
            border.width,
            totalHeight - parseInt(style.paddingY) * 2,
          );
        }
      }
    } catch (error) {
      console.error(`Error updating ${frame.name}:`, error);
    }
  }
}

async function createSvgNode(svgString, size) {
  try {
    // Create a node using the SVG data
    const node = figma.createNodeFromSvg(svgString);

    // Resize to desired dimensions while maintaining aspect ratio
    const scale = size / Math.max(node.width, node.height);
    node.resize(node.width * scale, node.height * scale);

    // Center if not square
    if (node.width !== node.height) {
      const frame = figma.createFrame();
      frame.resize(size, size);
      frame.fills = [];
      frame.appendChild(node);

      // Center the SVG in the frame
      node.x = (size - node.width) / 2;
      node.y = (size - node.height) / 2;

      return frame;
    }

    return node;
  } catch (error) {
    console.error("Error creating SVG node:", error);
    // Create a fallback placeholder
    const placeholder = figma.createFrame();
    placeholder.resize(size, size);
    placeholder.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
    placeholder.cornerRadius = 4;
    return placeholder;
  }
}

function createIconsSection() {
  const section = figma.createFrame();
  section.name = "Icons";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 24;
  section.fills = [];

  // Create title
  const title = figma.createText();
  title.characters = "Icons";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  // Create grid container for icons
  const grid = figma.createFrame();
  grid.name = "Icon Grid";
  grid.layoutMode = "VERTICAL";
  grid.itemSpacing = 16;
  grid.fills = [];
  grid.resize(400, 250);

  // Create rows with different icon sizes
  const sizes = [16, 24, 32];

  sizes.forEach((size) => {
    // Create row container
    const row = figma.createFrame();
    row.name = `${size}px Icons`;
    row.layoutMode = "HORIZONTAL";
    row.itemSpacing = 24;
    row.fills = [];
    row.resize(400, size + 32); // Add padding
    row.counterAxisAlignItems = "CENTER";

    // Create size label
    const label = figma.createText();
    label.characters = `${size}px`;
    label.fontSize = 14;
    label.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    row.appendChild(label);

    // Create icon placeholders
    for (let i = 0; i < 6; i++) {
      const iconFrame = figma.createFrame();
      iconFrame.name = `Icon ${i + 1}`;
      iconFrame.resize(size, size);
      iconFrame.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
      iconFrame.cornerRadius = 4;
      row.appendChild(iconFrame);
    }

    grid.appendChild(row);
  });

  section.appendChild(grid);
  return section;
}

async function updateIconsSection(section, iconTokens) {
  if (!section || !iconTokens) return;

  const rows = section.findAll(
    (node) => node.type === "FRAME" && node.name.includes("px Icons"),
  );

  for (const row of rows) {
    const size = parseInt(row.name);
    const icons = row.findAll((node) => node.name.startsWith("Icon "));

    for (const [index, icon] of icons.entries()) {
      const tokenKey = `icon${index + 1}`;
      const style = iconTokens[tokenKey];

      if (style && style.svg) {
        try {
          // Remove existing icon content
          const existingIcon = icon.findChild(
            (n) => n.type === "VECTOR" || n.type === "FRAME",
          );
          if (existingIcon) {
            existingIcon.remove();
          }

          // Create new SVG node
          const svgNode = await createSvgNode(style.svg, size);

          // If the icon is a frame (placeholder), replace it
          if (icon.type === "FRAME") {
            const parent = icon.parent;
            const index = parent.children.indexOf(icon);
            icon.remove();
            parent.insertChild(index, svgNode);
          }

          // Apply color if specified
          if (style.color) {
            const vectors = svgNode.findAll((node) => node.type === "VECTOR");
            vectors.forEach((vector) => {
              vector.fills = [
                {
                  type: "SOLID",
                  color: validateAndConvertColor(style.color),
                },
              ];
            });
          }
        } catch (error) {
          console.error(`Error updating icon ${tokenKey}:`, error);
        }
      }
    }
  }
}

async function createQuoteSection() {
  // Load required fonts first
  await Promise.all([
    figma.loadFontAsync({ family: "Inter", style: "Regular" }),
    figma.loadFontAsync({ family: "Inter", style: "Medium" }),
    figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }),
    figma.loadFontAsync({ family: "Inter", style: "Bold" }),
  ]).catch((error) => {
    console.error("Error loading fonts:", error);
    throw new Error("Failed to load required fonts");
  });

  const section = figma.createFrame();
  section.name = "Quotes";
  section.layoutMode = "VERTICAL";
  section.itemSpacing = 16; // Reduced from 32
  section.fills = [];

  // Create title
  const title = figma.createText();
  title.characters = "Quotes";
  title.fontSize = 16;
  title.fontName = { family: "Inter", style: "Semi Bold" };
  section.appendChild(title);

  // Create quote container
  const quoteFrame = figma.createFrame();
  quoteFrame.name = "Quote";
  quoteFrame.layoutMode = "VERTICAL";
  quoteFrame.itemSpacing = 8; // Reduced from 16
  quoteFrame.paddingLeft = 16; // Reduced from 24
  quoteFrame.paddingRight = 16; // Reduced from 24
  quoteFrame.paddingTop = 16; // Reduced from 24
  quoteFrame.paddingBottom = 16; // Reduced from 24
  quoteFrame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  quoteFrame.cornerRadius = 6; // Reduced from 8
  quoteFrame.resize(320, 140); // Reduced from 600x200

  // Create quote symbol
  const quoteSymbol = figma.createText();
  quoteSymbol.characters = '"';
  quoteSymbol.fontSize = 32; // Reduced from 48
  quoteSymbol.fontName = { family: "Inter", style: "Bold" };
  quoteSymbol.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];

  // Create quote text
  const quoteText = figma.createText();
  quoteText.characters = "Insert your inspirational quote here."; // Shortened text
  quoteText.fontSize = 14; // Reduced from 20
  quoteText.fontName = { family: "Inter", style: "Regular" };
  quoteText.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];

  // Create author text
  const authorText = figma.createText();
  authorText.characters = "— Author Name";
  authorText.fontSize = 12; // Reduced from 14
  authorText.fontName = { family: "Inter", style: "Medium" };
  authorText.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];

  quoteFrame.appendChild(quoteSymbol);
  quoteFrame.appendChild(quoteText);
  quoteFrame.appendChild(authorText);
  section.appendChild(quoteFrame);

  return section;
}

async function updateQuoteSection(section, quoteData) {
  if (!section || !quoteData) {
    console.error("Missing section or quote data");
    return;
  }

  try {
    // Find the quote frame
    const quoteFrame = section.findOne(
      (node) => node.type === "FRAME" && node.name === "Quote",
    );
    if (!quoteFrame) {
      console.error("Quote frame not found");
      return;
    }

    // Update frame styles if provided
    if (quoteData.styles) {
      if (quoteData.styles.backgroundColor) {
        quoteFrame.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(quoteData.styles.backgroundColor),
          },
        ];
      }
      if (quoteData.styles.cornerRadius) {
        quoteFrame.cornerRadius = parseInt(quoteData.styles.cornerRadius);
      }
      if (quoteData.styles.padding) {
        quoteFrame.paddingLeft = parseInt(quoteData.styles.padding);
        quoteFrame.paddingRight = parseInt(quoteData.styles.padding);
        quoteFrame.paddingTop = parseInt(quoteData.styles.padding);
        quoteFrame.paddingBottom = parseInt(quoteData.styles.padding);
      }
    }

    // Find and update the quote symbol
    const quoteSymbol = quoteFrame.findOne(
      (node) => node.type === "TEXT" && node.characters === '"',
    );
    if (quoteSymbol && quoteData.quoteSymbol) {
      await figma.loadFontAsync(quoteSymbol.fontName);
      if (quoteData.quoteSymbol.color) {
        quoteSymbol.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(quoteData.quoteSymbol.color),
          },
        ];
      }
      if (quoteData.quoteSymbol.fontSize) {
        quoteSymbol.fontSize = parseInt(quoteData.quoteSymbol.fontSize);
      }
    }

    // Find and update the quote text
    const quoteText = quoteFrame.findOne(
      (node) =>
        node.type === "TEXT" &&
        !node.characters.startsWith("—") &&
        node.characters !== '"',
    );
    if (quoteText && quoteData.quote) {
      await figma.loadFontAsync(quoteText.fontName);
      quoteText.characters = quoteData.quote.text || quoteText.characters;

      if (quoteData.quote.color) {
        quoteText.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(quoteData.quote.color),
          },
        ];
      }
      if (quoteData.quote.fontSize) {
        quoteText.fontSize = parseInt(quoteData.quote.fontSize);
      }
    }

    // Find and update the author text
    const authorText = quoteFrame.findOne(
      (node) => node.type === "TEXT" && node.characters.startsWith("—"),
    );
    if (authorText && quoteData.author) {
      await figma.loadFontAsync(authorText.fontName);
      authorText.characters = `— ${quoteData.author.name}`;

      if (quoteData.author.color) {
        authorText.fills = [
          {
            type: "SOLID",
            color: validateAndConvertColor(quoteData.author.color),
          },
        ];
      }
      if (quoteData.author.fontSize) {
        authorText.fontSize = parseInt(quoteData.author.fontSize);
      }
    }

    // Force a repaint of the frame
    quoteFrame.resize(quoteFrame.width, quoteFrame.height);
  } catch (error) {
    console.error("Error updating quote section:", error);
  }
}
