// Centralized conversions and unit registry for LiveCalc
// Edit this file to update FX rates or add/remove unit definitions.
(function(){
  window.LC_CONVERSIONS = window.LC_CONVERSIONS || {};

  // FX rates expressed relative to USD (1 USD = 1)
  window.LC_CONVERSIONS.fxRates = {
    USD: 1.0,
    EUR: 1.08,
    GBP: 1.25,
    JPY: 0.0072,
    CHF: 1.09,
    AUD: 0.66,
    CAD: 0.74
  };

  // List of recognized currency unit codes
  window.LC_CONVERSIONS.currencyUnits = ["USD","EUR","GBP","JPY","CHF","AUD","CAD"];

  // Common units to register: [name, definition-for-mathjs]
  window.LC_CONVERSIONS.commonUnits = [
    ['mm', '0.001 m'],
    ['cm', '0.01 m'],
    ['dm', '0.1 m'],
    ['m', '1 m'],
    ['km', '1000 m'],
    ['mg', '1e-6 kg'],
    ['g', '0.001 kg'],
    ['kg', '1 kg'],
    ['t', '1000 kg'],

    // Volume / liters
    ['ml', '1e-6 m^3'],
    ['l', '0.001 m^3'],
    ['L', '0.001 m^3'],

    // Area / volume
    ['cm2', '0.0001 m^2'],
    ['m2', '1 m^2'],
    ['cm3', '1e-6 m^3'],
    ['m3', '1 m^3'],

    // Time
    ['s', '1 s'],
    ['sec', '1 s'],
    ['min', '60 s'],
    ['h', '3600 s'],

    // Imperial / US customary
    ['in', '0.0254 m'],
    ['ft', '0.3048 m'],
    ['yd', '0.9144 m'],
    ['mi', '1609.344 m'],
    ['oz', '0.028349523125 kg'],
    ['lb', '0.45359237 kg'],
    // Additional imperial / engineering units
    ['psi', '6894.757293168 Pa'],
    ['lbf', '4.4482216152605 N'],
    ['gal', '0.003785411784 m^3'],
    ['gallon', '0.003785411784 m^3'],
    ['ft3', '0.028316846592 m^3'],
    ['in2', '0.00064516 m^2'],
    ['in^2', '0.00064516 m^2'],
    ['in3', '1.6387064e-5 m^3'],
    ['in^3', '1.6387064e-5 m^3'],
    ['ft2', '0.09290304 m^2'],
    ['ft^2', '0.09290304 m^2'],
    ['ft3', '0.028316846592 m^3'],
    ['ft^3', '0.028316846592 m^3'],
    // psi variants / alias
    ['lbf_per_in2', 'psi'],
    ['pound_force_per_square_inch', 'psi'],
    ['slug', '14.593902937206 kg'],

    // Pressure / energy (basic)
    ['atm', '101325 Pa'],
    ['bar', '100000 Pa'],

    // Common aliases
    ['percent', '0.01'],
  ];
})();
