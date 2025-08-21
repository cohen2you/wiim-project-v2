# Modular Story Builder

The WIIM Story Generator now includes a **Modular Approach** that allows you to build stories by adding independent components without affecting the existing article structure.

## How to Use

### 1. Enable Modular Mode
- Click the "Standard Mode" button in the top-right corner to switch to "Modular Mode"
- The button will turn green when modular mode is active

### 2. Add Components Independently
In modular mode, you can add any of these components in any order:

- **Headline & Lead** - Generate both headline and lead paragraph together (recommended starting point)
- **Technical Analysis** - Add technical analysis section
- **Analyst Ratings** - Include analyst sentiment and ratings
- **Edge Ratings** - Add Benzinga Edge rankings
- **News Context** - Include related news articles with links (automatic)
- **Custom Context** - Manually select specific articles to include as context
- **Price Action** - Add current price action information
- **Also Read Link** - Insert "Also Read" links

**Note**: The "WGO No News" button now automatically generates both headline and lead paragraph in one step, since these are essential for every story.

### 3. Manage Components
Each component can be:
- **Toggled on/off** using the checkbox
- **Reordered** using the up/down arrows
- **Removed** using the X button
- **Previewed** in the component list

### 4. Key Benefits

#### Independence
- Adding links/price action won't affect your existing article
- Each component is generated and stored separately
- You can add components in any order

#### Flexibility
- Toggle components on/off without regenerating
- Reorder components to change story flow
- Remove components you don't want

#### Non-Destructive
- Your existing article structure is preserved
- Components are added without rebuilding the entire story
- You can experiment with different combinations

### 5. Story Preview
The modular builder shows a live preview of your story as you add and manage components. The final story is automatically assembled in the correct order.

### 6. Custom Context Feature
The "Custom Context" option allows you to:
- Browse recent articles for the ticker
- Select specific articles you want to include as context
- Generate context paragraphs with hyperlinks to your chosen articles
- Have full control over which articles are referenced

This is different from the automatic "News Context" which uses AI to select relevant articles automatically.

### 7. Copy Functionality
Use the "Copy Article" button to copy the final story to your clipboard in both HTML and plain text formats.

## Switching Between Modes

- **Standard Mode**: Traditional step-by-step approach
- **Modular Mode**: Independent component-based approach

You can switch between modes at any time. The modular approach is especially useful when you want to:
- Add components without affecting existing content
- Experiment with different story structures
- Build stories incrementally
- Have more control over the final output

## Technical Details

The modular approach uses a component-based architecture where:
- Each component is stored with a unique ID
- Components maintain their own state (active/inactive, order)
- The story is rebuilt by combining active components in order
- Special handling for "Also Read" links ensures proper placement 