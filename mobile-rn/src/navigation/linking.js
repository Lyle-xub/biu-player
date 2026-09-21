export const PLAYER_LINK = 'biu-player://lyrics?showLyrics=1';

// Both a cold launch and a tap while backgrounded resolve inside our stack.
export const linking = {
  prefixes: ['biu-player://'],
  filter: url => /^biu-player:\/\/lyrics(?:[/?#]|$)/i.test(url),
  config: {
    initialRouteName: 'Tabs',
    screens: {
      Player: { path: 'lyrics', parse: { showLyrics: value => value === '1' },
        stringify: { showLyrics: value => value ? '1' : '0' } },
    },
  },
};
