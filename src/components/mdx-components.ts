/**
 * The tag vocabulary available to MDX authors.
 *
 * One entry per author-facing name, plus aliases for common documentation
 * markup. Each component owns its own DOM; styles/components.css owns
 * its appearance. Adding a component is one new .astro file and one line here —
 * page templates never change.
 */
import Accordion from './Accordion.astro';
import AccordionGroup from './AccordionGroup.astro';
import ApiResponseDetails from './ApiResponseDetails.astro';
import Badge from './Badge.astro';
import Banner from './Banner.astro';
import Button from './Button.astro';
import CTA from './CTA.astro';
import Callout from './Callout.astro';
import Card from './Card.astro';
import CardGroup from './CardGroup.astro';
import Check from './Check.astro';
import CodeBlock from './CodeBlock.astro';
import CodeGroup from './CodeGroup.astro';
import Color from './Color.astro';
import ColorItem from './ColorItem.astro';
import ColorRow from './ColorRow.astro';
import Column from './Column.astro';
import Columns from './Columns.astro';
import Danger from './Danger.astro';
import Endpoint from './Endpoint.astro';
import Examples from './Examples.astro';
import Expandable from './Expandable.astro';
import Frame from './Frame.astro';
import HeadingThree from './HeadingThree.astro';
import HeadingTwo from './HeadingTwo.astro';
import Icon from './Icon.astro';
import Info from './Info.astro';
import Mermaid from './Mermaid.astro';
import Note from './Note.astro';
import Panel from './Panel.astro';
import ParamField from './ParamField.astro';
import Prompt from './Prompt.astro';
import ResponseField from './ResponseField.astro';
import Step from './Step.astro';
import Steps from './Steps.astro';
import Tab from './Tab.astro';
import Tabs from './Tabs.astro';
import Tile from './Tile.astro';
import Tip from './Tip.astro';
import Tooltip from './Tooltip.astro';
import Tree from './Tree.astro';
import TreeFile from './TreeFile.astro';
import TreeFolder from './TreeFolder.astro';
import Update from './Update.astro';
import View from './View.astro';
import Visibility from './Visibility.astro';
import Warning from './Warning.astro';

/* MDX member expressions such as `<Color.Row>` resolve properties from the
   mapped component value. Keep the flat aliases too: they are friendlier to
   Astro authors and preserve existing content. */
const ColorNamespace = Object.assign(Color, { Row: ColorRow, Item: ColorItem });
const TreeNamespace = Object.assign(Tree, { Folder: TreeFolder, File: TreeFile });

export const mdxComponents = {
  Accordion,
  AccordionGroup,
  ApiResponseDetails,
  Badge,
  Banner,
  Button,
  Callout,
  Card,
  CardGroup,
  CTA,
  Check,
  CodeBlock,
  CodeGroup,
  Color: ColorNamespace,
  ColorItem,
  ColorRow,
  Column,
  Columns,
  Danger,
  Endpoint,
  Examples,
  Expandable,
  Frame,
  Icon,
  Info,
  Mermaid,
  Note,
  Panel,
  ParamField,
  Prompt,
  ResponseField,
  Step,
  Steps,
  Tab,
  Tabs,
  Tile,
  Tip,
  Tooltip,
  Tree: TreeNamespace,
  TreeFile,
  TreeFolder,
  Update,
  View,
  Visibility,
  Warning,

  // Concise aliases for familiar documentation patterns.
  FileTree: TreeNamespace,
  Folder: TreeFolder,
  File: TreeFile,
  LinkButton: Button,
  RequestExample: Examples,
  ResponseExample: Examples,
  Response: ResponseField,

  // Headings get anchor links and copyable permalinks.
  h2: HeadingTwo,
  h3: HeadingThree,
};
