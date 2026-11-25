package aria

/*
#include "aria_core.h"
*/
import "C"

func cABIVersion() C.uint32_t {
	return C.aria_core_abi_version()
}
