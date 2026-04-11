export interface PinSpec {
  type: 'io' | 'input_only' | 'power' | 'gnd';
  buses: string[];
  pwm: boolean;
  adc: boolean;
  notes: string;
}

export interface BoardSpec {
  id: string;
  name: string;
  fqbn: string;
  voltage: number;
  features: string[];
  price: number;
  complexity: 'beginner' | 'intermediate' | 'advanced';
  max3v3CurrentMa: number;
  strappingPins: string[];
  inputOnlyPins: string[];
  i2cBuses: number;
  i2sPorts: number;
  spiBuses: number;
  pins: Record<string, PinSpec>;
}

export interface BoardRequirements {
  needsWifi?: boolean;
  needsBluetooth?: boolean;
  needsCamera?: boolean;
  needsSdCard?: boolean;
  minGpioPins?: number;
  needs5vLogic?: boolean;
  needsAnalogPins?: number;
  budgetFriendly?: boolean;
}

export interface BoardRecommendation {
  primary: BoardSpec;
  alternatives: BoardSpec[];
  reasoning: string;
}

export interface ComponentSpec {
  id: string;
  name: string;
  bus: 'i2c' | 'i2s' | 'spi' | 'digital' | 'analog' | 'pwm' | 'single_wire';
  busDirection: 'input' | 'output' | 'bidirectional';
  voltage: string;
  currentDrawMa: number;
  pinsNeeded: string[];
  defaultAddress: string | null;
  libraries: string[];
  notes: string;
  keywords: string[];
}

export interface PinAssignment {
  component: string;
  componentPin: string;
  boardPin: string;
  notes: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  component: string;
  message: string;
}

export interface PowerReport {
  totalCurrentMa: number;
  maxCurrentMa: number;
  overBudget: boolean;
  marginMa: number;
}

export interface DesignSpec {
  boardId: string;
  boardName: string;
  boardFqbn: string;
  components: string[];
  pinAssignments: PinAssignment[];
  libraries: string[];
  powerReport: PowerReport;
  validationIssues: ValidationIssue[];
  alternativeBoards: Array<{ id: string; name: string; reasoning: string }>;
  summary: string;
}

export interface WiringStep {
  stepNumber: number;
  component: string;
  fromPoint: string;
  toPoint: string;
  wireColor: string;
  notes: string;
}

export interface WiringInstructions {
  steps: WiringStep[];
  powerRails: string[];
  busSummary: string[];
}
