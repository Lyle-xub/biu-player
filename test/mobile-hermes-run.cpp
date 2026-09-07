#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <fstream>
#include <sstream>
#include <iostream>

// Execute source as Worklets does, using the exact Hermes shipped in iOS Pods.
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  auto runtime = facebook::hermes::makeHermesRuntime();
  std::ifstream input(argv[1]);
  if (!input) return 2;
  std::stringstream source;
  source << input.rdbuf();
  try {
    auto result = runtime->evaluateJavaScript(
      std::make_shared<facebook::jsi::StringBuffer>(source.str()), argv[1]);
    if (result.isString()) std::cout << result.getString(*runtime).utf8(*runtime) << std::endl;
  } catch (const facebook::jsi::JSError &error) {
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
