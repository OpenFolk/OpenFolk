require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# For iOS projects that use CocoaPods instead of Swift Package Manager
Pod::Spec.new do |s|
  s.name = 'OpenfolkNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/openfolk/openfolk'
  s.author = 'OpenFolk'
  s.source = { :path => '.' }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
