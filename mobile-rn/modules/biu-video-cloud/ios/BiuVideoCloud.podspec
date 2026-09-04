Pod::Spec.new do |s|
  s.name = 'BiuVideoCloud'
  s.version = '1.0.0'
  s.summary = 'On-device Biu video cloud carrier'
  s.description = s.summary
  s.license = { :type => 'BSD-3-Clause' }
  s.author = 'Biu Player'
  s.homepage = 'https://github.com'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}', '../cpp/**/*.{h,cpp}'
  s.public_header_files = 'BIUCarrier.h'
  s.frameworks = 'AVFoundation', 'CoreVideo'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17', 'HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)/../cpp' }
end
