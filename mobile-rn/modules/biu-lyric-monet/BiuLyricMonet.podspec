Pod::Spec.new do |s|
  s.name = 'BiuLyricMonet'
  s.version = '1.0.0'
  s.summary = 'Native iOS Monet lyric glow for Biu Player'
  s.description = s.summary
  s.license = { :type => 'BSD-3-Clause' }
  s.author = 'Biu Player'
  s.homepage = 'https://github.com/Lyle-xub/biu-player'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/**/*.swift'
  s.frameworks = 'UIKit', 'CoreGraphics', 'NaturalLanguage'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
