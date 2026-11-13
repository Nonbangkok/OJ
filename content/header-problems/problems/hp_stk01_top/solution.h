// Reference solution: the top of the stack is the last slot in use, so top()
// is a single indexed read — O(1) and, being const, it must not touch mSize.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
const T &CP::stack<T>::top() const
{
  // Your code here
  return mData[mSize - 1];
}

#endif
