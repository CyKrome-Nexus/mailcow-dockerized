/*
 * CyKrome Workspaces — SOGo Angular Material Theme
 * Configures the Angular Material palette to follow the brand accent.
 */
(function () {
  'use strict';

  function currentAccent() {
    var stored = null;
    try { stored = window.localStorage.getItem('mailcow_accent'); } catch (e) {}
    return (stored === 'cyan' || stored === 'amber') ? stored : 'violet';
  }

  var ACCENT_PALETTES = {
    violet: { primary: '8B5CF6', accent: 'A78BFA' },
    cyan:   { primary: '06B6D4', accent: '22D3EE' },
    amber:  { primary: 'F59E0B', accent: 'FBBF24' }
  };

  angular.module('SOGo.Common').config(configure);

  configure.$inject = ['$mdThemingProvider'];
  function configure($mdThemingProvider) {
    var chosen = ACCENT_PALETTES[currentAccent()] || ACCENT_PALETTES.violet;

    var cykromePrimary = $mdThemingProvider.extendPalette('purple', {
      '500': chosen.primary,
      '600': chosen.primary,
      '700': chosen.primary,
      'A200': chosen.accent
    });
    var cykromeAccent = $mdThemingProvider.extendPalette('purple', {
      'A100': chosen.accent,
      'A200': chosen.accent,
      'A400': chosen.accent
    });
    var cykromeDark = $mdThemingProvider.extendPalette('grey', {
      '50': '2A2927',
      '100': '222220',
      '200': '1C1B19',
      '300': '14151C',
      '800': 'E7E8EE',
      '900': 'F4F4F7'
    });

    $mdThemingProvider.definePalette('cykrome-primary', cykromePrimary);
    $mdThemingProvider.definePalette('cykrome-accent', cykromeAccent);
    $mdThemingProvider.definePalette('cykrome-dark', cykromeDark);

    $mdThemingProvider.theme('default')
      .primaryPalette('cykrome-primary', {
        'default': '500',
        'hue-1': '600',
        'hue-2': '700',
        'hue-3': 'A200'
      })
      .accentPalette('cykrome-accent', {
        'default': 'A200',
        'hue-1': 'A100',
        'hue-2': 'A400',
        'hue-3': 'A700'
      })
      .backgroundPalette('cykrome-dark');

    $mdThemingProvider.generateThemesOnDemand(false);
  }
})();
