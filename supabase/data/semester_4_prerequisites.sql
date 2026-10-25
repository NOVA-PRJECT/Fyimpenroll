-- User-requested practical knowledge/skill drafts; not official university prerequisite statements.
-- Run only against the reviewed 38-course Semester 4 catalogue. No other semesters are changed.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.courses IN SHARE ROW EXCLUSIVE MODE;
DO $configure$
DECLARE
  drafts jsonb := $guidance$[
  {
    "course_code": "KU04DSCECO205",
    "title": "ADVANCED MICRO ECONOMICS",
    "prerequisites": [
      "You should understand demand, supply, market equilibrium, and price elasticity.",
      "You should be able to use basic algebra and read graphs showing consumer choices, costs, and revenue.",
      "You should understand marginal changes and the basic idea of differentiation."
    ]
  },
  {
    "course_code": "KU04DSCECO206",
    "title": "ADVANCED MACRO ECONOMICS",
    "prerequisites": [
      "You should understand national income, inflation, unemployment, and economic growth.",
      "You should know the basic roles of money, banks, government spending, and taxation.",
      "You should be able to interpret simple economic graphs, percentages, and equations."
    ]
  },
  {
    "course_code": "KU04DSCECO207",
    "title": "ENVIRONMENTAL ECONOMICS",
    "prerequisites": [
      "You should understand scarcity, opportunity cost, and the basic working of markets.",
      "You should be familiar with pollution, natural resources, and the relationship between economic activity and the environment.",
      "You should be able to compare simple costs and benefits using tables or graphs."
    ]
  },
  {
    "course_code": "KU04DSCECO208",
    "title": "PUBLIC FINANCE",
    "prerequisites": [
      "You should understand the basic roles of markets and government in an economy.",
      "You should know the difference between taxes, government spending, borrowing, and a budget deficit.",
      "You should be able to work with percentages and interpret simple budget tables."
    ]
  },
  {
    "course_code": "KU04DSCEVS205",
    "title": "Advanced Environmental Chemistry",
    "prerequisites": [
      "You should understand atoms, molecules, chemical bonding, and common chemical reactions.",
      "You should be familiar with acids, bases, pH, concentration, and oxidation-reduction reactions.",
      "You should be able to balance simple chemical equations and perform basic concentration calculations."
    ]
  },
  {
    "course_code": "KU04DSCEVS206",
    "title": "Basics of Hydrology",
    "prerequisites": [
      "You should understand the water cycle, precipitation, evaporation, infiltration, and runoff.",
      "You should be able to work with units of length, area, volume, and time.",
      "You should be able to interpret simple graphs, tables, and maps."
    ]
  },
  {
    "course_code": "KU04DSCEVS207",
    "title": "Energy and Environment",
    "prerequisites": [
      "You should understand the basic ideas of energy, power, work, and energy conservation.",
      "You should be familiar with renewable and non-renewable resources and common forms of environmental pollution.",
      "You should be able to perform simple calculations using units, percentages, and ratios."
    ]
  },
  {
    "course_code": "KU04DSCEVS208",
    "title": "Environmental Chemistry Practical 1",
    "prerequisites": [
      "You should understand basic laboratory safety, hazard labels, and the purpose of protective equipment.",
      "You should be able to measure mass and liquid volume and calculate simple solution concentrations.",
      "You should understand pH, acids and bases, and how to record observations and units clearly."
    ]
  },
  {
    "course_code": "KU04DSCMAT201",
    "title": "CALCULUS III",
    "prerequisites": [
      "You should be able to differentiate and integrate standard functions of one variable.",
      "You should understand limits, continuity, and the basic ideas of sequences and series.",
      "You should be comfortable with algebraic manipulation, trigonometric identities, and exponential and logarithmic functions."
    ]
  },
  {
    "course_code": "KU04DSCMAT202",
    "title": "INTRODUCTION TO GRAPH THEORY",
    "prerequisites": [
      "You should understand sets, relations, functions, and basic logical statements.",
      "You should be able to follow a short mathematical argument and work with simple counting problems."
    ]
  },
  {
    "course_code": "KU04DSCMAT203",
    "title": "LINEAR ALGEBRA I",
    "prerequisites": [
      "You should be able to solve simultaneous linear equations using basic algebra.",
      "You should understand basic matrix operations, including matrix addition and multiplication.",
      "You should be familiar with vectors, coordinate geometry, and elementary mathematical notation."
    ]
  },
  {
    "course_code": "KU04DSCMAT204",
    "title": "VECTOR VALUED FUNCTIONS AND MULTIVARIABLE CALCULUS",
    "prerequisites": [
      "You should be able to differentiate and integrate standard functions of one variable.",
      "You should be familiar with vectors, dot products, cross products, and three-dimensional coordinates.",
      "You should understand limits and continuity and be able to manipulate algebraic and trigonometric expressions."
    ]
  },
  {
    "course_code": "KU04DSCPES205",
    "title": "Kinesiology and Sports Biomechanics",
    "prerequisites": [
      "You should be familiar with the main bones, joints, and muscles involved in human movement.",
      "You should understand basic ideas of force, motion, balance, and leverage.",
      "You should be able to read simple movement diagrams and work with units of distance, time, and speed."
    ]
  },
  {
    "course_code": "KU04DSCPES206",
    "title": "Emerging Trends in Sports Management",
    "prerequisites": [
      "You should understand the basic structure of sports teams, clubs, and competitions.",
      "You should be able to organise information in a simple schedule or budget and calculate basic percentages."
    ]
  },
  {
    "course_code": "KU04DSCPES207",
    "title": "Yogic Science for Wellness",
    "prerequisites": [
      "You should be familiar with the basic ideas of posture, breathing, relaxation, and personal well-being.",
      "You should understand common movement terms and be able to follow simple written or demonstrated instructions."
    ]
  },
  {
    "course_code": "KU04DSCPES208",
    "title": "Major Game – Softball and Cricket",
    "prerequisites": [
      "You should recognise basic terms used in batting, bowling or pitching, catching, and fielding.",
      "You should be able to follow simple game rules, scoring instructions, and team roles."
    ]
  },
  {
    "course_code": "KU04DSCPSY205",
    "title": "CLINICAL PSYCHOLOGY-1",
    "prerequisites": [
      "You should understand basic psychological concepts such as behaviour, emotion, learning, and personality.",
      "You should be familiar with the difference between everyday distress and persistent difficulties that may affect daily functioning.",
      "You should understand the importance of confidentiality, respectful language, and avoiding unsupported diagnoses."
    ]
  },
  {
    "course_code": "KU04DSCPSY206",
    "title": "BIOLOGICAL BASIS OF BEHAVIOR",
    "prerequisites": [
      "You should understand basic biological ideas about cells, neurons, and communication within the nervous system.",
      "You should be familiar with basic psychological concepts such as sensation, learning, emotion, and behaviour.",
      "You should be able to read simple biological diagrams and follow basic scientific terminology."
    ]
  },
  {
    "course_code": "KU04DSCPSY207",
    "title": "SCHOOL PSYCHOLOGY",
    "prerequisites": [
      "You should understand basic ideas about child and adolescent development, learning, and motivation.",
      "You should be familiar with the roles of families, teachers, and school environments in student well-being.",
      "You should understand the importance of confidentiality and respectful treatment of individual differences."
    ]
  },
  {
    "course_code": "KU04DSCPSY208",
    "title": "HEALTH PSYCHOLOGY",
    "prerequisites": [
      "You should understand basic psychological ideas about behaviour, emotions, stress, and coping.",
      "You should be familiar with the relationship between everyday habits, social surroundings, and physical well-being.",
      "You should be able to distinguish a personal opinion from a claim supported by evidence."
    ]
  },
  {
    "course_code": "KU04DSCSTA208",
    "title": "INTRODUCTION TO BIOSTATISTICS",
    "prerequisites": [
      "You should be able to work with percentages, ratios, averages, and basic graphs.",
      "You should understand the difference between a population and a sample and recognise common types of data.",
      "You should be familiar with basic probability and variation in observations."
    ]
  },
  {
    "course_code": "KU04DSCSTA211",
    "title": "Elementary Statistical Inference",
    "prerequisites": [
      "You should understand probability, random variables, and common probability distributions.",
      "You should be able to calculate and interpret means, variances, and standard deviations.",
      "You should be familiar with samples and populations and be able to use basic algebra."
    ]
  },
  {
    "course_code": "KU04DSCSTA212",
    "title": "Applied Statistics-I",
    "prerequisites": [
      "You should understand descriptive statistics, probability, and the difference between populations and samples.",
      "You should be able to organise data in tables and interpret graphs and summary measures.",
      "You should be able to perform calculations using basic algebra, percentages, and ratios."
    ]
  },
  {
    "course_code": "KU04DSCSTA213",
    "title": "Statistical Computing Using R",
    "prerequisites": [
      "You should be able to use files and folders and organise data in a simple spreadsheet.",
      "You should understand basic statistical ideas such as averages, variation, probability, and graphs.",
      "You should be able to follow step-by-step instructions and recognise simple variables and formulas."
    ]
  },
  {
    "course_code": "KU04SECECO201",
    "title": "Corporate Social Responsibility",
    "prerequisites": [
      "You should understand the basic roles of businesses, employees, customers, and communities.",
      "You should be able to identify the people affected by a business decision and describe a simple ethical issue."
    ]
  },
  {
    "course_code": "KU04SECECO202",
    "title": "Entrepreneurship Development",
    "prerequisites": [
      "You should be able to describe a problem that a product or service could solve.",
      "You should be able to calculate simple costs, revenue, and profit using basic arithmetic."
    ]
  },
  {
    "course_code": "KU04SECMAT20",
    "title": "BASIC COURSE IN LATEX",
    "prerequisites": [
      "You should be able to type text, create folders, and save and locate files on a computer.",
      "You should be familiar with basic mathematical notation such as fractions, powers, subscripts, and equations."
    ]
  },
  {
    "course_code": "KU04SECPSY201",
    "title": "STRESS MANAGEMENT",
    "prerequisites": [
      "You should understand basic ideas about emotions, behaviour, and everyday stress.",
      "You should be able to identify common everyday stressors and take part in simple self-reflection activities."
    ]
  },
  {
    "course_code": "KU04SECSTA201",
    "title": "DATA ANALYSIS USING EXCEL",
    "prerequisites": [
      "You should be able to use a computer, create files, and enter information in rows and columns.",
      "You should understand basic arithmetic, percentages, averages, and simple charts."
    ]
  },
  {
    "course_code": "KU04SECSTA202",
    "title": "DATA ANALYSIS USING SPSS",
    "prerequisites": [
      "You should be able to organise a small dataset in rows and columns and identify different types of variables.",
      "You should understand basic statistical ideas such as averages, variation, frequencies, and graphs."
    ]
  },
  {
    "course_code": "KU04VACECO203",
    "title": "Public Speaking",
    "prerequisites": [
      "You should be able to read a short passage and explain its main message in your own words.",
      "You should be able to organise a simple idea into an introduction, main points, and a conclusion."
    ]
  },
  {
    "course_code": "KU04VACECO204",
    "title": "Economics of Startup and Entrepreneurship",
    "prerequisites": [
      "You should understand the basic ideas of customers, demand, prices, and competition.",
      "You should be able to calculate simple business costs, revenue, and profit."
    ]
  },
  {
    "course_code": "KU04VACPSY202",
    "title": "DRIVING AND ROAD RAGE BEHAVIOR",
    "prerequisites": [
      "You should understand basic road rules and the importance of attention and responsible behaviour in traffic.",
      "You should be able to describe how emotions, frustration, and social influences can affect everyday decisions."
    ]
  },
  {
    "course_code": "KU4DSCCSE205",
    "title": "Database Management System",
    "prerequisites": [
      "You should be able to use files and folders and enter or organise information in tables.",
      "You should understand basic programming ideas such as variables, conditions, and loops.",
      "You should be familiar with sets, logical conditions, and relationships between items."
    ]
  },
  {
    "course_code": "KU4DSCCSE206",
    "title": "System Software and Operating System",
    "prerequisites": [
      "You should be able to read simple programs using variables, conditions, loops, and functions.",
      "You should understand the basic roles of the processor, memory, storage, and input/output devices.",
      "You should be able to use files, folders, and basic command-line operations."
    ]
  },
  {
    "course_code": "KU4DSCCSE207",
    "title": "Digital Electronics and Computer Organization",
    "prerequisites": [
      "You should be able to work with binary numbers and convert simple values between binary and decimal.",
      "You should understand basic Boolean logic, truth tables, and AND, OR, and NOT operations.",
      "You should know the basic roles of the processor, memory, and input/output devices."
    ]
  },
  {
    "course_code": "KU4DSCCSE208",
    "title": "Data and Business Analytics",
    "prerequisites": [
      "You should be able to organise data in tables and use a spreadsheet for simple calculations.",
      "You should understand averages, percentages, variation, and the interpretation of basic charts.",
      "You should be able to read a simple business question and identify the data needed to answer it."
    ]
  },
  {
    "course_code": "KU4DSCCSE301",
    "title": "Foundations of Electrical and Electronics Engineering",
    "prerequisites": [
      "You should be able to rearrange simple algebraic equations and work with standard measurement units.",
      "You should understand the basic meanings of voltage, current, resistance, and electrical power.",
      "You should be familiar with simple circuit symbols and basic series and parallel connections."
    ]
  }
]$guidance$::jsonb;
  expected_count integer := jsonb_array_length(drafts);
  matched_count integer;
  updated_count integer;
BEGIN
  SELECT count(*) INTO matched_count FROM public.courses c
    JOIN jsonb_to_recordset(drafts) AS draft(course_code text,title text,prerequisites jsonb)
      ON c.course_code=draft.course_code AND c.title=draft.title AND c.semester=4;
  IF matched_count <> expected_count OR (SELECT count(*) FROM public.courses WHERE semester=4) <> expected_count THEN
    RAISE EXCEPTION 'Semester 4 catalogue changed; refresh the draft before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM public.courses WHERE semester=4 AND prerequisites <> '[]'::jsonb) THEN
    RAISE EXCEPTION 'Existing Semester 4 prerequisites found; preserve and review them before applying';
  END IF;
  UPDATE public.courses c SET prerequisites=draft.prerequisites
    FROM jsonb_to_recordset(drafts) AS draft(course_code text,title text,prerequisites jsonb)
    WHERE c.semester=4 AND c.course_code=draft.course_code AND c.title=draft.title AND c.prerequisites='[]'::jsonb;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN RAISE EXCEPTION 'Expected % course updates, got %',expected_count,updated_count; END IF;
END
$configure$;
COMMIT;
