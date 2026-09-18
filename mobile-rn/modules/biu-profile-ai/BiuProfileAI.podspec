Pod::Spec.new do |s|
  s.name = 'BiuProfileAI'
  s.version = '1.0.0'
  s.summary = 'Serial background local recommendation inference'
  s.license = { :type => 'MIT' }
  s.author = 'Biu Player'
  s.homepage = 'https://github.com/Lyle-xub/biu-player'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'onnxruntime-objc', '1.24.3'
  s.source_files = 'ios/**/*.swift'
  s.frameworks = 'UIKit', 'CryptoKit', 'ImageIO'
end
